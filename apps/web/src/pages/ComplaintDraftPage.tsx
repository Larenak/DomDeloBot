import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { caseApi } from '../api.js';
import { ErrorState, LoadingState } from '../components/StateViews.js';

export function ComplaintDraftPage() {
  const { caseId = '' } = useParams();
  const query = useQuery({ queryKey: ['case', caseId], queryFn: () => caseApi.get(caseId) });
  const [addressee, setAddressee] = useState('');
  const [applicant, setApplicant] = useState('');
  const [address, setAddress] = useState('');
  const [contact, setContact] = useState('');
  const [copied, setCopied] = useState(false);
  if (query.isPending) return <main className="page"><LoadingState label="Готовим черновик" /></main>;
  if (query.isError) return <main className="page"><ErrorState message={query.error.message}
    onRetry={() => void query.refetch()} /></main>;
  const item = query.data;
  const text = [
    'Кому: ' + (addressee.trim() || '[наименование организации]'),
    'От: ' + (applicant.trim() || '[ФИО заявителя]'),
    'Адрес: ' + (address.trim() || '[адрес дома и квартиры]'),
    'Контакт для ответа: ' + (contact.trim() || '[почтовый адрес или электронная почта]'),
    '',
    'ОБРАЩЕНИЕ',
    'по вопросу: ' + item.title,
    '',
    item.description,
    'Место: ' + item.place + (item.entrance ? ', подъезд ' + item.entrance : '') + '.',
    'В ДомДеле создано внутреннее дело №' + item.number + ' от ' +
      new Date(item.createdAt).toLocaleDateString('ru-RU') + '.',
    '',
    'Прошу проверить изложенные обстоятельства, принять меры по устранению проблемы и сообщить мне о результатах рассмотрения по указанному контакту.',
    item.attachments.length ? 'Приложения: фотографии (' + item.attachments.length + ' шт.).' : '',
    '',
    'Дата: ' + new Date().toLocaleDateString('ru-RU'),
    'Подпись: __________________',
  ].filter((line) => line !== undefined).join('\n');
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'obrashchenie-' + item.number + '.txt';
    link.click();
    URL.revokeObjectURL(url);
  };
  return <main className="page page--narrow">
    <Link className="back-link" to={'/cases/' + item.id}>← Назад к делу</Link>
    <section className="content-card">
      <h1>Черновик обращения</h1>
      <p>Заполните реквизиты и проверьте текст перед отправкой через официальный канал. Создание этого черновика не отправляет заявление.</p>
      <label>Адресат<input value={addressee} onChange={(event) => setAddressee(event.target.value)}
        placeholder="Например, действующая УК" /></label>
      <label>ФИО заявителя<input value={applicant} onChange={(event) => setApplicant(event.target.value)} /></label>
      <label>Адрес дома и квартиры<input value={address} onChange={(event) => setAddress(event.target.value)} /></label>
      <label>Контакт для ответа<input value={contact} onChange={(event) => setContact(event.target.value)} /></label>
      <textarea className="complaint-preview" value={text} readOnly aria-label="Текст обращения" />
      <div className="action-row">
        <button type="button" className="button button--primary" onClick={() => void copy()}>
          {copied ? 'Скопировано' : 'Скопировать'}
        </button>
        <button type="button" className="button button--secondary" onClick={download}>Скачать текст</button>
      </div>
    </section>
  </main>;
}
