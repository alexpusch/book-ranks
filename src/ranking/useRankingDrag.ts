import { useState, type RefObject } from 'react';
import {
  KeyboardSensor, MouseSensor, TouchSensor, rectIntersection, pointerWithin,
  useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { GALLERY, booksAt, locationOf, moveBook, type Board, type BoardChange } from '../board/board';

const collisionDetection: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    const hits = pointerWithin(args);
    const hit = hits.find((item) =>
      args.droppableContainers.find((container) => container.id === item.id)?.data.current?.kind === 'book') ?? hits[0];
    return hit ? [hit] : [];
  }
  return rectIntersection(args).slice(0, 1);
};


export function useRankingDrag(
  boardRef: RefObject<Board>, change: BoardChange, setNotice: (notice: string) => void, onError: (error: unknown) => void,
) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, scrollBehavior: 'auto' }),
  );

  function move(id: string, destination: string, index?: number) {
    if (change((current) => moveBook(current, id, destination, index))) {
      const title = boardRef.current.books.find((book) => book.id === id)!.title;
      const name = destination === GALLERY ? 'the reading pile' : boardRef.current.tiers.find((tier) => tier.id === destination)!.name;
      setNotice(`Moved ${title} to ${name}.`);
    }
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (!over || active.id === over.id) return;
    try {
      const current = boardRef.current;
      const id = String(active.id);
      const overId = String(over.id);
      const overBook = current.books.some((book) => book.id === overId);
      const destination = overBook ? locationOf(current, overId) : overId;
      const index = overBook ? booksAt(current, destination).indexOf(overId) : undefined;
      move(id, destination, index);
    } catch (error) {
      onError(error);
    }
  }


  return {
    sensors, collisionDetection,
    activeBook: boardRef.current.books.find((book) => book.id === activeId),
    onDragStart: ({ active, activatorEvent }: DragStartEvent) =>
      setActiveId(activatorEvent instanceof KeyboardEvent ? null : String(active.id)),
    onDragEnd,
    onDragCancel: () => setActiveId(null),
  };
}
