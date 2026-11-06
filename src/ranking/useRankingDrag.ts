import { useState, type RefObject } from 'react';
import {
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  rectIntersection,
  pointerWithin,
  closestCenter,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { GALLERY, booksAt, locationOf, moveBook, type Board, type BoardChange } from '../board/board';

const collisionDetection: CollisionDetection = (args) => {
  if (args.pointerCoordinates) {
    const hits = pointerWithin(args);
    const bookHit = hits.find(
      (item) => args.droppableContainers.find((container) => container.id === item.id)?.data.current?.kind === 'book',
    );
    if (bookHit) return [bookHit];
    const zoneHit = hits[0];
    if (!zoneHit) return [];
    const books = args.droppableContainers.filter(
      (container) => container.data.current?.kind === 'book' && container.data.current.location === zoneHit.id,
    );
    return books.length ? closestCenter({ ...args, droppableContainers: books }).slice(0, 1) : [zoneHit];
  }
  return rectIntersection(args).slice(0, 1);
};

export function useRankingDrag(
  boardRef: RefObject<Board>,
  change: BoardChange,
  setNotice: (notice: string) => void,
  onError: (error: unknown) => void,
) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; destination: string; index: number } | null>(null);
  const previewBoard = preview
    ? moveBook(boardRef.current, preview.id, preview.destination, preview.index)
    : boardRef.current;
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      scrollBehavior: 'auto',
    }),
  );

  function move(id: string, destination: string, index?: number) {
    if (change((current) => moveBook(current, id, destination, index))) {
      const title = boardRef.current.books.find((book) => book.id === id)!.title;
      const name =
        destination === GALLERY
          ? 'the reading pile'
          : boardRef.current.tiers.find((tier) => tier.id === destination)!.name;
      setNotice(`Moved ${title} to ${name}.`);
    }
  }

  function onDragOver({ active, over }: DragOverEvent) {
    // Keep the keyboard's focused node mounted; only pointer drags move between zones during preview.
    if (!activeId || !over || active.id === over.id) return;
    try {
      const id = String(active.id);
      const overId = String(over.id);
      const overBook = previewBoard.books.some((book) => book.id === overId);
      const destination = overBook ? locationOf(previewBoard, overId) : overId;
      const target = booksAt(previewBoard, destination);
      if (locationOf(previewBoard, id) === destination) {
        if (preview && !overBook && target.indexOf(id) !== target.length - 1)
          setPreview({ id, destination, index: target.length - 1 });
        return;
      }
      const index = overBook ? target.indexOf(overId) : target.length;
      setPreview({ id, destination, index });
    } catch (error) {
      onError(error);
    }
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    setPreview(null);
    if (!over || (active.id === over.id && !preview)) return;
    try {
      const current = previewBoard;
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

  function onDragStart({ active, activatorEvent }: DragStartEvent) {
    const keyboard = activatorEvent instanceof KeyboardEvent;
    const focused = document.activeElement;
    if (
      !keyboard &&
      focused instanceof HTMLElement &&
      focused.closest('[data-book-id]')?.getAttribute('data-book-id') === String(active.id)
    ) {
      focused.blur();
    }
    setPreview(null);
    setActiveId(keyboard ? null : String(active.id));
  }

  return {
    sensors,
    collisionDetection,
    previewBoard,
    activeBook: boardRef.current.books.find((book) => book.id === activeId),
    onDragStart,
    onDragOver,
    onDragEnd,
    onDragCancel: () => {
      setActiveId(null);
      setPreview(null);
    },
  };
}
