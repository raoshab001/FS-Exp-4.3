// server.js
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Config: lock TTL in ms
const LOCK_TTL = 60_000; // 1 minute

app.use(cors());
app.use(express.json());

// In-memory seats store:
// seats[seatId] = { status: 'available' | 'locked' | 'booked', lockedBy?: string, lockExpiresAt?: number, timeoutId?: NodeJS.Timeout }
const seats = {};
const TOTAL_SEATS = 10;

// Initialize seats 1..TOTAL_SEATS as available
for (let i = 1; i <= TOTAL_SEATS; i += 1) {
  seats[i] = { status: 'available' };
}

// Helper: clear lock timer safely
function clearSeatTimer(seat) {
  if (seat && seat.timeoutId) {
    clearTimeout(seat.timeoutId);
    seat.timeoutId = undefined;
  }
}

// Helper: set auto-expiry for a locked seat
function armSeatExpiry(seatId) {
  const seat = seats[seatId];
  clearSeatTimer(seat);
  seat.timeoutId = setTimeout(() => {
    // If still locked and past expiry, release it
    const now = Date.now();
    if (seats[seatId].status === 'locked' && seats[seatId].lockExpiresAt && seats[seatId].lockExpiresAt <= now) {
      seats[seatId] = { status: 'available' };
    }
  }, LOCK_TTL + 50); // slight buffer to ensure time check
}

// GET /seats -> map of seatId -> status
app.get('/seats', (_req, res) => {
  // Return minimal public view
  const view = {};
  Object.entries(seats).forEach(([id, seat]) => {
    view[id] = { status: seat.status };
  });
  res.status(200).json(view);
});

// POST /lock/:id?user=U123 -> lock seat for user for 1 minute
app.post('/lock/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = String(req.query.user || 'anonymous');

  if (!seats[id]) {
    return res.status(404).json({ message: `Seat ${id} does not exist.` });
  }

  const seat = seats[id];
  const now = Date.now();

  // If locked but expired, release first
  if (seat.status === 'locked' && seat.lockExpiresAt && seat.lockExpiresAt <= now) {
    clearSeatTimer(seat);
    seats[id] = { status: 'available' };
  }

  if (seats[id].status === 'booked') {
    return res.status(409).json({ message: `Seat ${id} is already booked.` });
  }

  if (seats[id].status === 'locked') {
    return res.status(423).json({ message: `Seat ${id} is already locked. Try another seat.` });
  }

  // Acquire lock
  const lockExpiresAt = now + LOCK_TTL;
  seats[id] = { status: 'locked', lockedBy: user, lockExpiresAt };
  armSeatExpiry(id);

  return res.status(200).json({ message: `Seat ${id} locked successfully. Confirm within 1 minute.` });
});

// POST /confirm/:id?user=U123 -> confirm booking if locked by same user and not expired
app.post('/confirm/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = String(req.query.user || 'anonymous');

  if (!seats[id]) {
    return res.status(404).json({ message: `Seat ${id} does not exist.` });
  }

  const seat = seats[id];
  const now = Date.now();

  if (seat.status !== 'locked') {
    return res.status(400).json({ message: 'Seat is not locked and cannot be booked' });
  }

  if (seat.lockExpiresAt && seat.lockExpiresAt <= now) {
    clearSeatTimer(seat);
    seats[id] = { status: 'available' };
    return res.status(408).json({ message: 'Lock expired. Please lock the seat again.' });
  }

  if (seat.lockedBy !== user) {
    return res.status(403).json({ message: 'Seat locked by another user.' });
  }

  // Confirm booking
  clearSeatTimer(seat);
  seats[id] = { status: 'booked' };
  return res.status(200).json({ message: `Seat ${id} booked successfully!` });
});

// Optional: unlock an active lock (admin/debug)
// POST /unlock/:id
app.post('/unlock/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!seats[id]) {
    return res.status(404).json({ message: `Seat ${id} does not exist.` });
  }
  const seat = seats[id];
  if (seat.status === 'available') {
    return res.status(200).json({ message: `Seat ${id} already available.` });
  }
  if (seat.status === 'booked') {
    return res.status(409).json({ message: `Seat ${id} is booked; cannot unlock.` });
  }
  clearSeatTimer(seat);
  seats[id] = { status: 'available' };
  return res.status(200).json({ message: `Seat ${id} lock cleared.` });
});

app.listen(PORT, () => {
  console.log(`Seat Booking API running at http://localhost:${PORT}`);
});
