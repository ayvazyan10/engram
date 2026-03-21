import { useEffect } from 'react';
import { getSocket } from '../lib/socket.js';
import { useNeuralStore } from '../store/neuralStore.js';
import { useMemoryStore } from '../store/memoryStore.js';

export function useWebSocket() {
  const { activateNeuron, deactivateNeuron, setConnected } = useNeuralStore();
  const { addRecord } = useMemoryStore();

  useEffect(() => {
    const socket = getSocket();

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('neuron:activated', ({ id }: { id: string }) => {
      activateNeuron(id);
      setTimeout(() => deactivateNeuron(id), 2000);
    });

    socket.on('memory:stored', (record: Parameters<typeof addRecord>[0]) => {
      addRecord(record);
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('neuron:activated');
      socket.off('memory:stored');
    };
  }, [activateNeuron, deactivateNeuron, setConnected, addRecord]);
}
