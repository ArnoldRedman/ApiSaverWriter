import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

const showStartupError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  root.render(
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: '#101820', color: '#eef5f8', fontFamily: 'system-ui, sans-serif' }}>
      <section style={{ width: 'min(100%, 480px)', padding: 24, border: '1px solid #36566a', borderRadius: 14, background: '#17242d', lineHeight: 1.65 }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 20 }}>应用加载失败</h1>
        <p style={{ margin: '0 0 14px', color: '#b9cbd4' }}>请关闭后重新打开应用；若问题持续，请记录以下错误信息。</p>
        <code style={{ display: 'block', overflowWrap: 'anywhere', color: '#ffbf86' }}>{message}</code>
      </section>
    </main>,
  );
};

// Keep module-load failures visible on every WebView. A static App import turns a
// syntax/runtime error into a silent native black screen before React can mount.
void import('./App')
  .then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  })
  .catch(showStartupError);
