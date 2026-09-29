import { useLayoutEffect, useMemo, useRef } from 'react';
import { splitQuizText } from './quiz-text.mjs';
import './quiz-content.css';

export function QuizContent({ text, className = '', fit = false, heading = false }) {
  const frameRef = useRef(null), contentRef = useRef(null);
  const segments = useMemo(() => splitQuizText(text), [text]);
  const hasCode = segments.some(segment => segment.type === 'code');
  useLayoutEffect(() => {
    if (!fit) return;
    const frame = frameRef.current, content = contentRef.current;
    let disposed = false;
    const measure = () => {
      if (disposed || !frame.clientWidth || !frame.clientHeight) return;
      const maximum = parseFloat(getComputedStyle(frame).fontSize);
      const minimum = Math.min(maximum, hasCode ? 15 : 14);
      const fits = size => {
        content.style.fontSize = `${size}px`;
        return content.scrollWidth <= frame.clientWidth + 1 && content.scrollHeight <= frame.clientHeight + 1;
      };
      let low = minimum, high = maximum;
      if (fits(high)) low = high;
      else for (let i = 0; i < 9; i++) { const middle = (low + high) / 2; if (fits(middle)) low = middle; else high = middle; }
      fits(Math.floor(low * 10) / 10);
      // Extreme snippets remain scrollable rather than clipped or unreadably tiny.
      frame.dataset.overflow = String(content.scrollHeight > frame.clientHeight + 1 || content.scrollWidth > frame.clientWidth + 1);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(frame); measure();
    document.fonts?.ready.then(measure);
    window.addEventListener('resize', measure);
    return () => { disposed = true; observer.disconnect(); window.removeEventListener('resize', measure); };
  }, [text, fit, hasCode]);
  return <div ref={frameRef} className={`quiz-content ${fit ? 'quiz-content-fit' : ''} ${hasCode ? 'has-code' : ''} ${className}`} role={heading ? 'heading' : undefined} aria-level={heading ? 1 : undefined}>
    <div className="quiz-content-inner" ref={contentRef}>
      {segments.map((segment, index) => segment.type === 'code'
        ? <pre className="quiz-code" key={index}><code>{segment.value}</code></pre>
        : <span className="quiz-prose" key={index}>{segment.value}</span>)}
    </div>
  </div>;
}
