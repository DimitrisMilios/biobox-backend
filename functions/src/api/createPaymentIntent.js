const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db } = require('../config/firebase');
const Stripe = require('stripe');

// Use Stripe with the secret key from the environment
// We initialize Stripe inside the function or pass the key dynamically
// v2 functions can use defineSecret, but for simplicity we rely on process.env 
// as stated in the blueprint.

exports.createPaymentIntent = onCall(async (request) => {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16', // Use a recent Stripe API version
  });

  const { productId, lockerId, buyerName, buyerPhone } = request.data;

  // Basic validation
  if (!productId || !lockerId || !buyerName || !buyerPhone) {
    throw new HttpsError('invalid-argument', 'Missing required parameters: productId, lockerId, buyerName, buyerPhone');
  }

  try {
    // 1. Fetch the product from Firestore to get price_cents and seller_id
    const productRef = db.collection('products').doc(productId);
    const productSnap = await productRef.get();

    if (!productSnap.exists) {
      throw new HttpsError('not-found', 'Product not found');
    }

    const productData = productSnap.data();
    const { price_cents, seller_id } = productData;

    // 2. Fetch the seller from Firestore to get stripe_account_id
    const sellerRef = db.collection('sellers').doc(seller_id);
    const sellerSnap = await sellerRef.get();

    if (!sellerSnap.exists) {
      throw new HttpsError('not-found', 'Seller not found');
    }

    const sellerData = sellerSnap.data();
    const { stripe_account_id } = sellerData;

    if (!stripe_account_id) {
      throw new HttpsError('failed-precondition', 'Seller has not connected a Stripe account');
    }

    // 3. Create a Stripe PaymentIntent
    // The total amount is the product price. The platform fee would be taken here if configured,
    // but the blueprint specifies transfer_data to destination.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: price_cents,
      currency: 'eur', // Assuming EUR since it's for Greece
      payment_method_types: ['card'],
      transfer_data: {
        destination: stripe_account_id,
      },
      // 4. Embed lockerId, buyerName, and buyerPhone into the metadata
      metadata: {
        productId,
        lockerId,
        buyerName,
        buyerPhone,
        sellerId: seller_id
      },
    });

    // 5. Return clientSecret to the frontend
    return {
      clientSecret: paymentIntent.client_secret,
    };
  } catch (error) {
    console.error('Error creating PaymentIntent:', error);
    // Return a structured error
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', 'An error occurred while creating the payment intent.');
  }
});
