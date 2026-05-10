import type { WalkthroughRun } from '@/types/walkthrough';

const PHOTO = (seed: string) =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/900/1200`;

export const DEMO_RUN: WalkthroughRun = {
  id: 'demo',
  propertyId: 'prop_demo',
  propertyName: 'The Greenhouse · Ponsonby',
  type: 'pre_checkin',
  startedAt: new Date().toISOString(),
  shots: [
    { id: 's1', name: 'Entryway, from door', roomId: 'r1', roomName: 'Entry', referencePhotoUrl: PHOTO('entry-1'), required: true, order: 1 },
    { id: 's2', name: 'Sofa, head-on', roomId: 'r2', roomName: 'Living Room', referencePhotoUrl: PHOTO('sofa-1'), required: true, order: 2 },
    { id: 's3', name: 'Living rug, full', roomId: 'r2', roomName: 'Living Room', referencePhotoUrl: PHOTO('rug-1'), required: false, order: 3 },
    { id: 's4', name: 'Kitchen counters', roomId: 'r3', roomName: 'Kitchen', referencePhotoUrl: PHOTO('kitchen-1'), required: true, order: 4 },
    { id: 's5', name: 'Stovetop', roomId: 'r3', roomName: 'Kitchen', referencePhotoUrl: PHOTO('stovetop-1'), required: true, order: 5 },
    { id: 's6', name: 'Dining table', roomId: 'r4', roomName: 'Dining', referencePhotoUrl: PHOTO('dining-1'), required: false, order: 6 },
    { id: 's7', name: 'Bed, made', roomId: 'r5', roomName: 'Bedroom 1', referencePhotoUrl: PHOTO('bed-1'), required: true, order: 7 },
    { id: 's8', name: 'Bathroom 1, sink', roomId: 'r6', roomName: 'Bathroom 1', referencePhotoUrl: PHOTO('bath-1'), required: true, order: 8 },
  ],
};
