/**
 * `@types/react-syntax-highlighter` only declares the style barrel, not the
 * individual style modules. We import styles individually (see
 * `src/lib/theme/prism.ts`) so the bundle carries the handful of Prism themes
 * the catalogue actually uses instead of all of them.
 */
declare module 'react-syntax-highlighter/dist/cjs/styles/prism/*' {
  const style: Record<string, React.CSSProperties>;
  export default style;
}
