import { defineHandler } from 'void';
import page from '../../giin-agent/index.html?raw';

export const GET = defineHandler(() => page);
