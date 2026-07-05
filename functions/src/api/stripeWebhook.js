const { onRequest } = require('firebase-functions/v2/https');
const { db } = require('../config/firebase');
const Stripe = require('stripe');
const { createDeliveryRequest } = require('../services/boxnowService');

exports.stripeWebhook = onRequest(async (req, res) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16',
  });

  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    // 1. Verify the event using stripe.webhooks.constructEvent
    // Firebase raw body is available at req.rawBody
    event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    console.error(`Webhook Error: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // 2. Listen specifically for payment_intent.succeeded
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const piId = paymentIntent.id;
    const { lockerId, buyerPhone, buyerName, sellerId } = paymentIntent.metadata;

    const orderRef = db.collection('orders').doc(piId);

    try {
      // 3. Save a new document to the orders collection using PaymentIntent ID
      await orderRef.set({
        seller_id: sellerId,
        amount: paymentIntent.amount,
        locker_id: lockerId,
        buyer_phone: buyerPhone,
        status: 'Paid - Fetching PIN',
        created_at: new Date().toISOString()
      });

      // 4. Extract lockerId and buyerPhone from metadata and pass to BoxNow
      const voucherPin = await createDeliveryRequest(lockerId, buyerPhone, buyerName);

      // 5. Update the order document with the PIN and set status to "Ready for Dropoff"
      await orderRef.update({
        boxnow_pin: voucherPin,
        status: 'Ready for Dropoff'
      });

    } catch (error) {
      console.error('Error processing successful payment intent:', error);
      
      // 6. If BoxNow API fails, update order status to "Voucher Error"
      await orderRef.update({
        status: 'Voucher Error',
        error_details: error.message
      }).catch(e => console.error('Failed to update order with error status:', e));
      
      // Return 200 to Stripe so it doesn't retry infinitely
    }
  }

  // Return a 200 response to acknowledge receipt of the event
  res.json({received: true});
});
