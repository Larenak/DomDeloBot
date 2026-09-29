import type { CaseDto } from '@domdelo/contracts';
import { useEffect, useRef, useState } from 'react';

type Attachment = CaseDto['attachments'][number];

function photoLabel(attachment: Attachment): string {
  if (attachment.fileName === 'Учебная иллюстрация') return 'Учебная иллюстрация';
  return attachment.kind === 'result' ? 'Результат работы' : 'Фото проблемы';
}

export function PhotoGallery({ attachments }: { attachments: Attachment[] }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const active = activeIndex === null ? null : attachments[activeIndex];

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (active && !dialog.open) dialog.showModal();
    if (!active && dialog.open) dialog.close();
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setActiveIndex((index) => index === null ? null : (index - 1 + attachments.length) % attachments.length);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setActiveIndex((index) => index === null ? null : (index + 1) % attachments.length);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, attachments.length]);

  return (
    <>
      <div className="photo-grid">
        {attachments.map((attachment, index) => (
          <figure key={attachment.id}>
            <button
              className="photo-grid__open"
              type="button"
              aria-label={`Открыть ${photoLabel(attachment).toLowerCase()} ${index + 1} из ${attachments.length}`}
              onClick={() => setActiveIndex(index)}
            >
              <img src={attachment.url} alt={photoLabel(attachment)} loading="lazy" />
            </button>
            <figcaption>{attachment.kind === 'result' ? 'Результат' : 'Проблема'}</figcaption>
          </figure>
        ))}
      </div>
      <dialog
        ref={dialogRef}
        className="photo-lightbox"
        aria-label="Просмотр фотографии дела"
        onClose={() => setActiveIndex(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setActiveIndex(null);
        }}
      >
        {active ? (
          <div className="photo-lightbox__content">
            <div className="photo-lightbox__toolbar">
              <span>{photoLabel(active)} · {activeIndex! + 1} из {attachments.length}</span>
              <button type="button" className="photo-lightbox__close" aria-label="Закрыть фотографию" onClick={() => setActiveIndex(null)}>✕</button>
            </div>
            <img src={active.url} alt={photoLabel(active)} />
            {attachments.length > 1 ? (
              <div className="photo-lightbox__controls">
                <button type="button" onClick={() => setActiveIndex((activeIndex! - 1 + attachments.length) % attachments.length)}>← Предыдущее</button>
                <button type="button" onClick={() => setActiveIndex((activeIndex! + 1) % attachments.length)}>Следующее →</button>
              </div>
            ) : null}
          </div>
        ) : null}
      </dialog>
    </>
  );
}
