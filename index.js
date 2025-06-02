import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins for development
    methods: ['GET', 'POST'],
  },
});

// Object to store active rooms and their participants
// Structure: { roomId: [socketId1, socketId2, ...], ... }
const rooms = {};

// This object will store the video status for each user in each room.
// Structure: { roomId: { userId: boolean (isVideoEnabled), ... }, ... }
const userVideoStates = {};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Event: 'check-room' - Checks if a room with the given ID exists
  socket.on('check-room', ({ roomId }) => {
    const roomExists = rooms.hasOwnProperty(roomId);
    socket.emit('room-exists', { exists: roomExists });
  });

  // Event: 'create-room' - Creates a new room if it doesn't already exist
  socket.on('create-room', ({ roomId }) => {
    if (rooms.hasOwnProperty(roomId)) {
      // If room already exists, don't re-create it, just acknowledge
      console.warn(`Attempted to create room ${roomId} which already exists.`);
    } else {
      rooms[roomId] = []; // Initialize an empty array for the room participants
      userVideoStates[roomId] = {}; // Initialize video states for the new room
    }
    // The client will explicitly call 'join-room' after creating.
    console.log(`Room created: ${roomId} (not joined yet by creator)`);
    socket.emit('room-created', { roomId }); // Acknowledge creation
  });

  // Event: 'join-room' - Adds a user to a specified room
  socket.on('join-room', ({ roomId }) => {
    if (!rooms[roomId]) {
      // If room does not exist, notify the client
      socket.emit('room-not-found');
      return;
    }

    // Add user to the room if not already present
    if (!rooms[roomId].includes(socket.id)) {
      rooms[roomId].push(socket.id);
      // Set initial video state for the joining user to true (assuming video is on by default)
      userVideoStates[roomId][socket.id] = true;
    }
    socket.join(roomId); // Join the Socket.IO room
    console.log(`User ${socket.id} joined room: ${roomId}`);

    // Get all other users in the room (excluding the current user)
    const otherUsers = rooms[roomId].filter((id) => id !== socket.id);
    // Send the list of other users to the newly joined user
    socket.emit('all-users', otherUsers);

    // Send initial video states of all other users to the newly joined user
    const currentRoomVideoStates = {};
    otherUsers.forEach((userId) => {
      currentRoomVideoStates[userId] = userVideoStates[roomId][userId];
    });
    socket.emit('initial-video-states', currentRoomVideoStates);

    // Broadcast 'user-joined' event to all other users in the room
    socket.to(roomId).emit('user-joined', socket.id);

    // Event: 'offer' - Handles WebRTC offer signaling
    socket.on('offer', (payload) => {
      // Forward the offer to the target user
      io.to(payload.target).emit('offer', {
        sdp: payload.sdp,
        caller: socket.id, // The ID of the user sending the offer
      });
    });

    // Event: 'answer' - Handles WebRTC answer signaling
    socket.on('answer', (payload) => {
      // Forward the answer to the target user
      io.to(payload.target).emit('answer', {
        sdp: payload.sdp,
        caller: socket.id, // The ID of the user sending the answer
      });
    });

    // Event: 'ice-candidate' - Handles WebRTC ICE candidate signaling
    socket.on('ice-candidate', (payload) => {
      // Forward the ICE candidate to the target user
      io.to(payload.target).emit('ice-candidate', {
        candidate: payload.candidate,
        from: socket.id, // The ID of the user sending the candidate
      });
    });

    // NEW: Event: 'videoStateChange' - Handles changes in a user's video enabled/disabled state
    socket.on('videoStateChange', ({ videoEnabled }) => {
      console.log(
        `User ${socket.id} in room ${roomId} changed video state to: ${videoEnabled}`
      );
      userVideoStates[roomId][socket.id] = videoEnabled; // Update the state on the server

      // Broadcast the video state change to all other users in the same room
      socket.to(roomId).emit('remoteVideoStateChange', {
        userId: socket.id,
        videoEnabled: videoEnabled,
      });
    });

    // NEW: Event: 'midi-message' - Handles real-time MIDI data from a user
    socket.on('midi-message', (payload) => {
      // Re-broadcast the MIDI message to all other users in the same room
      socket.to(payload.roomId).emit('remote-midi-message', {
        userId: socket.id, // Sender's ID
        type: payload.type, // 'noteon' or 'noteoff'
        note: payload.note,
        velocity: payload.velocity,
        timestamp: payload.timestamp, // Client-side timestamp for potential synchronization
      });
      console.log(
        `MIDI message from ${socket.id} in room ${payload.roomId}: ${payload.type} note ${payload.note}`
      );
    });

    // Handle user disconnection from within the room context (specific to this 'join-room' listener)
    socket.on('disconnect', () => {
      if (rooms[roomId]) {
        // Remove the disconnected user from the room's participant list
        rooms[roomId] = rooms[roomId].filter((id) => id !== socket.id);
        // Remove the user's video state
        delete userVideoStates[roomId][socket.id];

        // Notify other users in the room about the disconnection
        socket.to(roomId).emit('user-disconnected', socket.id);

        // If the room becomes empty, delete the room and its associated states
        if (rooms[roomId].length === 0) {
          delete rooms[roomId];
          delete userVideoStates[roomId]; // Clean up video states for empty room
          console.log(`Room ${roomId} has been deleted (empty)`);
        }
      }
    });
  });

  // Handle general disconnection (if user disconnects without explicitly being in a room context)
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    // Iterate through all rooms to find and remove the disconnected user
    Object.keys(rooms).forEach((roomId) => {
      if (rooms[roomId].includes(socket.id)) {
        rooms[roomId] = rooms[roomId].filter((id) => id !== socket.id);
        if (userVideoStates[roomId]) {
          // Check if room's video states exist before deleting
          delete userVideoStates[roomId][socket.id]; // Remove user's video state
        }
        // Notify other users in that room about the disconnection
        socket.to(roomId).emit('user-disconnected', socket.id);

        // If the room becomes empty, delete the room and its associated states
        if (rooms[roomId].length === 0) {
          delete rooms[roomId];
          delete userVideoStates[roomId]; // Clean up video states for empty room
          console.log(`Room ${roomId} has been deleted (empty)`);
        }
      }
    });
  });
});

server.listen(5000, () => console.log('Server running on port 5000'));
