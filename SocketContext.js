import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';

const SocketContext = createContext();

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      const newSocket = io(process.env.REACT_APP_SERVER_URL || 'http://localhost:5000');
      
      newSocket.on('connect', () => {
        console.log('Connected to server');
        setConnected(true);
        newSocket.emit('join-room', user.id);
      });

      newSocket.on('disconnect', () => {
        console.log('Disconnected from server');
        setConnected(false);
      });

      newSocket.on('document-uploaded', (data) => {
        console.log('Document uploaded:', data);
      });

      newSocket.on('document-processed', (data) => {
        console.log('Document processed:', data);
      });

      newSocket.on('document-error', (data) => {
        console.log('Document processing error:', data);
      });

      newSocket.on('qa-started', (data) => {
        console.log('Q&A started:', data);
      });

      newSocket.on('qa-response', (data) => {
        console.log('Q&A response:', data);
      });

      newSocket.on('summary-started', (data) => {
        console.log('Summary started:', data);
      });

      newSocket.on('summary-completed', (data) => {
        console.log('Summary completed:', data);
      });

      setSocket(newSocket);

      return () => {
        newSocket.close();
      };
    }
  }, [user]);

  const value = {
    socket,
    connected
  };

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  );
};
