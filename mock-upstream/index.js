const express = require('express');
const app = express();
const PORT = 5000;

app.use(express.json());

// Sample target endpoints
app.get('/api/v1/users', (req, res) => {
  res.json({
    status: 'success',
    data: [
      { id: 1, name: 'Alice', role: 'engineer' },
      { id: 2, name: 'Bob', role: 'admin' }
    ]
  });
});

app.post('/api/v1/orders', (req, res) => {
  res.status(201).json({
    status: 'created',
    orderId: 'ORD-' + Math.floor(1000 + Math.random() * 9000),
    payloadReceived: req.body
  });
});

app.listen(PORT, () => {
  console.log(`[Mock Upstream API] Running on http://localhost:${PORT}`);
});