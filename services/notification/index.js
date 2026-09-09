require('../../shared/tracer').initTracer('notification-service');

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3006;

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

const notifications = [];

app.get('/health', (req, res) => res.json({ service: 'notification-service', status: 'UP' }));

app.post('/notify', (req, res) => {
  const { type, userId, message } = req.body;
  const notif = {
    id: `notif-${Date.now()}`,
    type,
    userId,
    message,
    sentAt: new Date().toISOString(),
    channel: 'EMAIL_SMTP'
  };
  notifications.push(notif);
  res.json({ status: 'DELIVERED', notification: notif });
});

app.get('/notifications/:userId', (req, res) => {
  const list = notifications.filter(n => n.userId === req.params.userId);
  res.json({ notifications: list, total: list.length });
});

app.listen(PORT, () => {
  console.log(`[notification-service] Listening on port ${PORT}`);
});
