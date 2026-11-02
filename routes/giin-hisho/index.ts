import { defineHandler } from 'void';
import page from '../../giin-hisho/index.html?raw';

export const GET = defineHandler(() => page);
