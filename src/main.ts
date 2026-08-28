import './style.css';
import { startApp } from './app.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas');
if (!canvas) throw new Error('#map-canvas not found');
if (!document.querySelector('#controls')) throw new Error('#controls not found');

// T10 wires the full stack (worker client → controller → renderer → animation
// → control panel). No auto-generate on load — T11 owns the first-load
// experience, so the canvas stays untouched until Generate or 🎲 is clicked.
startApp(canvas);
