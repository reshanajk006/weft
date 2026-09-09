require('../../shared/tracer').initTracer('support-service');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3009;
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3006';

const { chaosMiddleware } = require('../../shared/chaos');

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(chaosMiddleware('support-service'));

const tickets = [];

app.get('/health', (req, res) => res.json({ service: 'support-service', status: 'UP' }));

app.post('/tickets', (req, res) => {
  const { title, userId, priority = 'P2' } = req.body;
  const ticketId = `tck-${Date.now()}`;
  const ticket = { id: ticketId, title, userId, priority, status: 'OPEN', createdAt: new Date().toISOString() };
  tickets.push(ticket);

  axios.post(`${NOTIFICATION_SERVICE_URL}/notify`, {
    type: 'TICKET_CREATED',
    userId,
    message: `Support ticket ${ticketId} opened: ${title}`
  }).catch(() => {});

  res.status(201).json(ticket);
});

app.get('/stats', (req, res) => {
  res.json({ totalTickets: tickets.length, openTickets: tickets.filter(t => t.status === 'OPEN').length });
});

app.listen(PORT, () => {
  console.log(`[support-service] Listening on port ${PORT}`);
});
