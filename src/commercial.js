import { createHmac, timingSafeEqual } from 'node:crypto';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function stripeRequest(path, params = {}) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) form.set(key, String(value));
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${required('STRIPE_SECRET_KEY')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(`stripe_${response.status}`), { stripe: data });
  return data;
}

export function billingConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.JOBFLOW_STRIPE_PRICE_ID && process.env.JOBFLOW_PUBLIC_URL);
}

export async function createCheckoutSession({ businessId, customerEmail }) {
  const base = required('JOBFLOW_PUBLIC_URL').replace(/\/$/, '');
  return stripeRequest('checkout/sessions', {
    mode: 'subscription',
    'line_items[0][price]': required('JOBFLOW_STRIPE_PRICE_ID'),
    'line_items[0][quantity]': 1,
    success_url: `${base}/?billing=success`,
    cancel_url: `${base}/?billing=cancelled`,
    client_reference_id: businessId,
    customer_email: customerEmail,
    'metadata[business_id]': businessId,
    'subscription_data[metadata][business_id]': businessId,
  });
}

export async function createBillingPortal(customerId) {
  const base = required('JOBFLOW_PUBLIC_URL').replace(/\/$/, '');
  return stripeRequest('billing_portal/sessions', { customer: customerId, return_url: base });
}

function signatureParts(header) {
  const parts = Object.fromEntries(String(header ?? '').split(',').map((entry) => entry.split('=', 2)).filter(([k,v]) => k && v));
  return { timestamp: parts.t, signature: parts.v1 };
}

export function verifyStripeWebhook(raw, header, toleranceSeconds = 300) {
  const { timestamp, signature } = signatureParts(header);
  if (!timestamp || !signature) throw new Error('invalid Stripe signature header');
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) throw new Error('stale Stripe webhook signature');
  const expected = createHmac('sha256', required('STRIPE_WEBHOOK_SECRET')).update(`${timestamp}.${raw}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('invalid Stripe webhook signature');
  return JSON.parse(raw);
}

export function subscriptionUpdateFromStripe(event) {
  const object = event?.data?.object ?? {};
  if (event.type === 'checkout.session.completed') {
    return {
      businessId: object.metadata?.business_id ?? object.client_reference_id,
      customerId: object.customer ?? null,
      subscriptionId: object.subscription ?? null,
      status: 'active',
    };
  }
  if (String(event.type ?? '').startsWith('customer.subscription.')) {
    return {
      businessId: object.metadata?.business_id,
      customerId: object.customer ?? null,
      subscriptionId: object.id ?? null,
      status: ['active','trialing'].includes(object.status) ? 'active' : object.status === 'past_due' ? 'past_due' : 'inactive',
    };
  }
  return null;
}
