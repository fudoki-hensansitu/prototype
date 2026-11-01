import { defineHandler } from 'void';
import home from '../home/index.html?raw';

export const GET = defineHandler(() => home);
