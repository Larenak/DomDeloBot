import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { houseApi, serviceApi } from '../api.js';

const officialPortal = 'https://dom.gosuslugi.ru/';
const otherServices = [
  {
    title: 'Счётчики и начисления',
    detail: 'Показания, квитанции и платежи доступны через официальный сервис для подтверждённого жилья.',
    status: 'Не подключено к ДомДелу',
    href: officialPortal,
  },
  {
    title: 'Собрание собственников',
    detail: 'Официальное голосование проводится в установленном порядке. Опрос в ДомДеле показывает только предварительное мнение.',
    status: 'Официальное ОСС не подключено',
    href: 'https://cdn.dom.gosuslugi.ru/webhelp/new/topics/voting_process/c_voting_process-grazhd.html',
  },
  {
    title: 'Правила управления домом · № 416',
    detail: 'Постановление содержит обязанности управляющей организации и отдельные сроки для аварийной диспетчерской службы. Для обычной заявки срок нужно определять по виду работ и применимой норме.',
    status: 'Автоматический расчёт нормативного срока не подключён',
    facts: [
      'Пункт 13: о плановом сроке выполнения аварийной заявки сообщают в течение 30 минут после регистрации.',
      'Аварии внутридомовых систем воды, отопления и электроснабжения локализуют в течение 30 минут после регистрации заявки.',
      'Засор внутридомовой канализации устраняют в течение 2 часов после регистрации заявки.',
      'Аварийное повреждение указанных инженерных систем устраняют не позднее 3 суток с даты повреждения.',
      'Эти сроки нельзя автоматически применять к лифту или обычной замене лампы.',
    ],
    href: 'https://gji.tatarstan.ru/normativnie-dokumenti.htm?pub_id=3584812.htm',
  },
  {
    title: 'Арендатор и гостевой доступ',
    detail: 'Арендатор может создать внутреннее дело. Остальные права требуют подтверждения собственником или официальным сервисом.',
    status: 'Подтверждение прав не подключено',
    href: 'https://cdn.dom.gosuslugi.ru/webhelp/topics/mobapp/interface/realty/tab_home/c_interface_realty_tab_home_view-mobapp.html',
  },
];

function formatDate(value?: string): string {
  if (!value) return '';
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return iso ? iso[3] + '.' + iso[2] + '.' + iso[1] : value;
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

export function ServicesPage({ canCreate, canManage }: { canCreate: boolean; canManage: boolean }) {
  const houses = useQuery({ queryKey: ['house-context'], queryFn: houseApi.context });
  const house = houses.data?.houses.find((item) => item.id === houses.data?.activeHouseId);
  const publicData = useQuery({
    queryKey: ['public-housing', house?.id],
    queryFn: serviceApi.house,
    enabled: Boolean(house),
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
  const management = publicData.data?.management;
  const overhaul = publicData.data?.overhaul;
  const loading = Boolean(house && publicData.isPending);

  return <main className="page">
    <section className="hero"><div><span className="eyebrow">Услуги дома</span>
      <h1>Что доступно</h1>
      <p>{house?.isDemo ? 'Учебный пример сведений о доме и переход к официальным услугам.' : 'Открытые сведения о выбранном доме и переход к официальным услугам.'}</p>
    </div></section>
    <section className="content-card">
      <h2>Обращения и ремонт</h2>
      <p>Создайте дело о лифте, освещении или другой проблеме. Диспетчер может указать исполнителя и плановую дату.</p>
      {canCreate ? <Link className="button button--primary" to="/new">Создать дело</Link>
        : canManage ? <Link className="button button--secondary" to="/dispatcher">Открыть очередь</Link> : null}
    </section>
    <section className="content-card">
      <h2>Мнение собственников</h2>
      <p>Председатель может провести предварительный опрос по благоустройству.</p>
      <Link className="button button--secondary" to="/polls">Открыть опросы</Link>
    </section>
    <p className="services-house-label">Сведения по дому: <strong>{house?.address || 'дом не выбран'}</strong></p>
    {house?.isDemo ? <p className="demo-warning">Ниже вымышленные данные для демонстрации интерфейса. Это не сведения ГИС ЖКХ или ФРТ.</p> : null}
    <div className="service-grid">
      <section className="content-card">
        <h2>Управляющая компания</h2>
        {!house ? <p className="service-status">Выберите дом, чтобы увидеть сведения.</p> : loading ? <p>Загружаем сведения о доме…</p> : publicData.isError ? <p className="service-status">Не удалось загрузить данные. Попробуйте обновить страницу.</p>
          : management?.status === 'found' ? <>
            <p className="service-company">{management.name || (management.managementType === 'Непосредственное управление' ? 'Непосредственное управление домом' : 'Управляющая организация не указана')}</p>
            {management.managementType ? <p>Способ управления: {management.managementType}</p> : null}
            {house?.isDemo ? <p className="service-source-note">Учебная управляющая организация; не связана с настоящим домом.</p>
              : <p className="service-source-note">Сведения ГИС ЖКХ за август 2026 в обработке «Если быть точным». Набор опубликован {formatDate(management.snapshotDate)}. Организация могла измениться. <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>.</p>}
            {management.organizationUrl ? <a className="button button--secondary" href={management.organizationUrl} target="_blank" rel="noopener noreferrer">Карточка организации в ГИС ЖКХ ↗</a> : null}
          </> : <p className="service-status">
            {management?.status === 'unavailable' ? 'Источник временно недоступен.'
              : house?.isDemo ? 'У демонстрационного дома нет записи в официальном реестре.'
                : 'Для этого дома управляющая организация не найдена в открытом наборе.'}
          </p>}
        {!house?.isDemo ? <a className="service-source-link" href={management?.sourceUrl || 'https://tochno.st/datasets/gisgkh'} target="_blank" rel="noopener noreferrer">Источник данных ↗</a> : null}
      </section>
      <section className="content-card">
        <h2>Капитальный ремонт</h2>
        {!house ? <p className="service-status">Выберите дом, чтобы увидеть программу.</p> : loading ? <p>Проверяем региональную программу…</p> : publicData.isError ? <p className="service-status">Не удалось загрузить данные. Попробуйте обновить страницу.</p>
          : overhaul?.status === 'found' ? <>
            {overhaul.fundingMethod ? <p><strong>Фонд капремонта:</strong> {overhaul.fundingMethod}</p> : null}
            {overhaul.fundBalanceThousandRub !== undefined ? <p><strong>Остаток средств на работы:</strong> {formatAmount(overhaul.fundBalanceThousandRub)} тыс. ₽</p> : null}
            {overhaul.contributionRubPerSqM !== undefined ? <p><strong>Взнос на капремонт:</strong> {formatAmount(overhaul.contributionRubPerSqM)} ₽/м²</p> : null}
            {overhaul.includedAt ? <p><strong>В программе с:</strong> {formatDate(overhaul.includedAt)}</p> : null}
            {overhaul.updatedAt ? <p><strong>Данные дома обновлены:</strong> {formatDate(overhaul.updatedAt)}</p> : null}
            {overhaul.works.length > 0 ? <>
              <h3 className="service-subtitle">Работы по дому</h3>
              <ul className="service-work-list">{overhaul.works.slice(0, 8).map((work, index) => <li key={index}>
                <strong>{work.type}</strong>
                <span>{work.plannedYear ? 'План: ' + work.plannedYear : 'Срок не указан'}{work.completedDate ? ' · Завершено: ' + formatDate(work.completedDate) : ''}</span>
                {work.contractor ? <small>Подрядчик: {work.contractor}</small> : null}
              </li>)}</ul>
              {overhaul.works.length > 8 ? <details className="service-more"><summary>Показать все работы ({overhaul.works.length})</summary>
                <ul className="service-work-list">{overhaul.works.slice(8).map((work, index) => <li key={index}>
                  <strong>{work.type}</strong><span>{work.plannedYear ? 'План: ' + work.plannedYear : 'Срок не указан'}{work.completedDate ? ' · Завершено: ' + formatDate(work.completedDate) : ''}</span>
                  {work.contractor ? <small>Подрядчик: {work.contractor}</small> : null}
                </li>)}</ul></details> : null}
            </> : <p>Перечень работ для этого дома в опубликованной выгрузке не найден.</p>}
            {house?.isDemo ? <p className="service-source-note">Пример плана работ; даты и суммы вымышлены.</p>
              : overhaul.snapshotDate ? <p className="service-source-note">Выгрузка ФРТ от {formatDate(overhaul.snapshotDate)}. Плановые сроки могут меняться.</p> : null}
          </> : <p className="service-status">
            {overhaul?.status === 'unavailable' ? 'Не удалось проверить региональную выгрузку. Это не означает, что дом отсутствует в программе.'
              : house?.isDemo ? 'У демонстрационного дома нет записи в региональной программе.'
                : 'Дом не найден в опубликованной региональной программе.'}
          </p>}
        {!house?.isDemo ? <a className="service-source-link" href={overhaul?.sourceUrl || 'https://xn--80adsazqn.xn--p1aee.xn--p1ai/opendata'} target="_blank" rel="noopener noreferrer">Программа капремонта ФРТ ↗</a> : null}
        {!house?.isDemo && overhaul?.worksSourceUrl ? <a className="service-source-link" href={overhaul.worksSourceUrl} target="_blank" rel="noopener noreferrer">Выгрузка работ ФРТ ↗</a> : null}
        <a className="service-source-link" href="https://cdn.dom.gosuslugi.ru/webhelp/new/topics/public_part/view_repairs_regional_address_plan-och.html" target="_blank" rel="noopener noreferrer">Как проверить программу в ГИС ЖКХ ↗</a>
      </section>
      {otherServices.map((service) => <section className="content-card" key={service.title}>
        <h2>{service.title}</h2>
        <p>{service.detail}</p>
        {'facts' in service && service.facts ? <ul className="service-facts">{service.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul> : null}
        <p className="service-status">{service.status}</p>
        <a className="button button--secondary" href={service.href} target="_blank" rel="noopener noreferrer">Официальный источник ↗</a>
      </section>)}
    </div>
    <p className="muted">ДомДело показывает опубликованные сведения. За актуальной информацией и юридически значимыми действиями переходите к первоисточнику.</p>
  </main>;
}
