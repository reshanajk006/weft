require('../../shared/tracer').initTracer('order-service');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3004;

const CATALOG_SERVICE_URL = process.env.CATALOG_SERVICE_URL || 'http://localhost:3003';
const BILLING_SERVICE_URL = process.env.BILLING_SERVICE_URL || 'http://localhost:3005';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3006';
const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || 'http://localhost:3007';

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

const orders = [];

app.get('/health', (req, res) => res.json({ service: 'order-service', status: 'UP' }));

app.post('/orders', async (req, res) => {
  const { userId = 'u-001', items = [{ productId: 'p-001', qty: 1 }] } = req.body;
  const orderId = `ord-${uuidv4().substring(0, 8)}`;

  try {
    // 1. Fetch catalog details
    let totalAmount = 0;
    const enrichedItems = [];
    for (const item of items) {
      const prodRes = await axios.get(`${CATALOG_SERVICE_URL}/products/${item.productId}`);
      const prod = prodRes.data;
      const lineTotal = (prod.price || 1000) * item.qty;
      totalAmount += lineTotal;
      enrichedItems.push({ ...prod, qty: item.qty, lineTotal });
    }

    // 2. Generate invoice via Billing service
    let invoice = null;
    try {
      const billRes = await axios.post(`${BILLING_SERVICE_URL}/invoices`, {
        orderId,
        userId,
        amount: totalAmount,
      });
      invoice = billRes.data;
    } catch (e) {
      invoice = { id: `inv-${Date.now()}`, status: 'PENDING_PAYMENT' };
    }

    // 3. Send Notification
    axios.post(`${NOTIFICATION_SERVICE_URL}/notify`, {
      type: 'ORDER_CREATED',
      userId,
      orderId,
      message: `Order ${orderId} created for \$${totalAmount}`
    }).catch(() => {});

    // 4. Log Analytics
    axios.post(`${ANALYTICS_SERVICE_URL}/events`, {
      event: 'ORDER_PLACED',
      orderId,
      amount: totalAmount,
      timestamp: new Date().toISOString()
    }).catch(() => {});

    const newOrder = {
      id: orderId,
      userId,
      items: enrichedItems,
      totalAmount,
      status: 'CONFIRMED',
      invoiceId: invoice?.id,
      createdAt: new Date().toISOString(),
    };
    orders.push(newOrder);

    res.status(201).json(newOrder);
  } catch (err) {
    res.status(500).json({ error: 'Order processing failed', message: err.message });
  }
});

app.get('/orders/:id', (req, res) => {
  const ord = orders.find(o => o.id === req.params.id) || { id: req.params.id, status: 'PROCESSING', totalAmount: 24500 };
  res.json(ord);
});

app.listen(PORT, () => {
  console.log(`[order-service] Listening on port ${PORT}`);
});
