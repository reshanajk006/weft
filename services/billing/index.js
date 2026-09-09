require('../../shared/tracer').initTracer('billing-service');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3005;
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3006';

const { chaosMiddleware } = require('../../shared/chaos');

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(chaosMiddleware('billing-service'));

const invoices = [];

app.get('/health', (req, res) => res.json({ service: 'billing-service', status: 'UP' }));

app.post('/invoices', (req, res) => {
  const { orderId, userId, amount } = req.body;
  const invoiceId = `inv-${uuidv4().substring(0, 8)}`;

  const invoice = {
    id: invoiceId,
    orderId,
    userId,
    amount,
    status: 'PAID',
    paymentMethod: 'CORPORATE_PO',
    issuedAt: new Date().toISOString()
  };

  invoices.push(invoice);

  // Trigger Notification
  axios.post(`${NOTIFICATION_SERVICE_URL}/notify`, {
    type: 'INVOICE_GENERATED',
    userId,
    message: `Invoice ${invoiceId} issued for \$${amount}`
  }).catch(() => {});

  res.status(201).json(invoice);
});

app.get('/invoices/user/:userId', (req, res) => {
  const userInvoices = invoices.filter(i => i.userId === req.params.userId);
  res.json({ invoices: userInvoices, total: userInvoices.length });
});

app.listen(PORT, () => {
  console.log(`[billing-service] Listening on port ${PORT}`);
});
