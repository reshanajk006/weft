/**
 * NEXUS-IT Frontend Server
 * Serves the static dashboard UI and acts as a BFF for the gateway.
 */
require('./shared/tracer').initTracer('frontend-server');

const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const PORT = process.env.FRONTEND_PORT || 4000;

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  NEXUS-IT Dashboard  →  :${PORT}           ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  console.log(`  Open: http://localhost:${PORT}\n`);
});
