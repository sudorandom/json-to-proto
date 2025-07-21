import { createTheme } from '@uiw/codemirror-themes';
import { tags as t } from '@lezer/highlight';

// Custom theme matching your site's colors
export const siteTheme = createTheme({
  theme: 'dark',
  settings: {
    background: '#0f172a', // Tailwind slate-900
    backgroundImage: '',
    foreground: '#a7f3d0', // Tailwind cyan-300
    caret: '#22d3ee', // Tailwind cyan-500
    selection: '#164e6399', // Tailwind cyan-900 with opacity
    selectionMatch: '#164e6399',
    lineHighlight: '#33415566', // Tailwind slate-700 with opacity
    gutterBorder: '1px solid #164e63',
    gutterBackground: '#0f172a',
    gutterForeground: '#64748b', // Tailwind slate-400
  },
  styles: [
    { tag: t.comment, color: '#64748b' }, // slate-400
    { tag: t.variableName, color: '#22d3ee' }, // cyan-500
    { tag: [t.string, t.special(t.brace)], color: '#a7f3d0' }, // cyan-300
    { tag: t.number, color: '#fb923c' }, // orange-400
    { tag: t.bool, color: '#a78bfa' }, // violet-400
    { tag: t.null, color: '#fb7185' }, // rose-400
    { tag: t.keyword, color: '#22d3ee' }, // cyan-500
    { tag: t.operator, color: '#22d3ee' },
    { tag: t.className, color: '#fde047' }, // yellow-300
    { tag: t.definition(t.typeName), color: '#fde047' }, // yellow-300
    { tag: t.typeName, color: '#fde047' }, // yellow-300
    { tag: t.angleBracket, color: '#a7f3d0' },
    { tag: t.tagName, color: '#a3e635' }, // lime-400
    { tag: t.attributeName, color: '#38bdf8' }, // sky-400
  ],
});
