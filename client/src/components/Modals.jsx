import modalsHtml from '../fragments/modals.html?raw';

// Rendered via dangerouslySetInnerHTML rather than hand-converted JSX: this
// fragment has many inline `style="..."` strings, which JSX requires as
// style={{...}} objects instead — converting ~10 of them by hand risked a
// silent camelCase/typo mistake with no way to verify visually this session.
// Copied verbatim from the prior EJS partial; the onclick="" attributes still
// work as plain DOM attributes inside an injected subtree.
export default function Modals() {
  return <div dangerouslySetInnerHTML={{ __html: modalsHtml }} />;
}
