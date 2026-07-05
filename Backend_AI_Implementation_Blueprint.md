# AI Developer Prompt: BoxNow & Stripe Backend Implementation

**Context for AI Agent:**
You are an expert Node.js and Firebase backend architect. You are building the serverless backend for an "Instagram-to-BoxNow" e-commerce checkout platform. The system uses Stripe Connect (Destination Charges) for split payments and the BoxNow API for courier locker routing. 

**Strict Architectural Rules You Must Follow:**
1. **Zero Trust Frontend:** Do not trust the frontend for pricing. Always fetch `price_cents` from Firestore using the `productId`.
2. **Secret Manager:** Never hardcode API keys. Use `process.env` populated by Firebase Secret Manager (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BOXNOW_CLIENT_ID`, `BOXNOW_CLIENT_SECRET`).
3. **Webhook Verification:** The webhook function MUST mathematically verify the `stripe-signature` header before executing any logic.
4. **Idempotency:** Use the `Stripe PaymentIntent ID` as the Firestore `order_id` document ID to prevent duplicate BoxNow voucher generation if webhooks fire twice.

---

## Step 1: Project Structure
Generate the code matching this structure inside the `functions/` directory:
```text
functions/
 ┣ index.js                  # Entry point, exports all functions
 ┣ package.json              # Dependencies: firebase-admin, firebase-functions, stripe, axios
 ┣ src/
 ┃ ┣ config/
 ┃ ┃ ┗ firebase.js           # Admin SDK initialization
 ┃ ┣ api/
 ┃ ┃ ┣ createPaymentIntent.js # Callable function
 ┃ ┃ ┗ stripeWebhook.js       # HTTP function
 ┃ ┗ services/
 ┃   ┗ boxnowService.js       # Axios calls to BoxNow API
```

---

## Step 2: Database Schema & Rules Implementation
Provide the `firestore.rules` file based on this strict schema:

* **`sellers` (Collection):** Doc ID = `seller_uid`. Fields: `email`, `stripe_account_id`. (Rules: Read/Write only by owner).
* **`products` (Collection):** Doc ID = `product_id`. Fields: `seller_id`, `price_cents`, `name`. (Rules: Public Read, Write by owner).
* **`orders` (Collection):** Doc ID = `stripe_pi_id`. Fields: `seller_id`, `amount`, `locker_id`, `boxnow_pin`, `buyer_phone`, `status`. (Rules: Read by owner, Write ONLY by Cloud Functions).

---

## Step 3: Function 1 - `createPaymentIntent` (HTTPS Callable)
Write the Firebase Callable function:
1. **Input:** `productId`, `lockerId`, `buyerName`, `buyerPhone`.
2. **Logic:** - Fetch the product from Firestore to get `price_cents` and `seller_id`.
   - Fetch the seller from Firestore to get `stripe_account_id`.
   - Create a Stripe PaymentIntent with `transfer_data: { destination: stripe_account_id }`.
   - Embed `lockerId`, `buyerName`, and `buyerPhone` into the Stripe PaymentIntent `metadata`.
3. **Output:** Return `clientSecret` to the frontend.

---

## Step 4: Function 2 - `stripeWebhook` (HTTP Request)
Write the Stripe Webhook handler:
1. **Security:** Verify the event using `stripe.webhooks.constructEvent`.
2. **Event Match:** Listen specifically for `payment_intent.succeeded`.
3. **Database Write (Initial):** Save a new document to the `orders` collection using the `event.data.object.id` (PaymentIntent ID). Set status to "Paid - Fetching PIN".
4. **Logistics Trigger:** Extract the `lockerId` and `buyerPhone` from the Stripe metadata. Pass these to the `boxnowService.js`.
5. **Database Update (Final):** Once BoxNow returns the 10-digit PIN, update the order document with the PIN and set status to "Ready for Dropoff".
6. **Error Handling:** If BoxNow API fails, catch the error, log it, update order status to "Voucher Error", and return `200` to Stripe (so it doesn't retry infinitely).

---

## Step 5: Service - `boxnowService.js`
Write the API interaction layer using `axios`:
1. **Auth:** POST to BoxNow `/api/v1/auth-services/token` using Client ID/Secret to get a Bearer Token.
2. **Request:** POST to `/api/v1/delivery-requests` with the target `lockerId` and recipient details.
3. **Return:** Extract and return the voucher ID/PIN from the response.
