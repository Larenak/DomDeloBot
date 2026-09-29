import { Link } from 'react-router-dom';

const officialPortal = 'https://dom.gosuslugi.ru/';
const services = [
  {
    title: 'Капитальный ремонт',
    detail: 'Программа, сроки и сведения о фонде доступны после сопоставления вашего дома с официальной записью.',
    status: 'Официальные данные дома не подключены',
    href: 'https://cdn.dom.gosuslugi.ru/webhelp/topics/repairs/repairs_info_list/repairs_method_decision/search-rokr.html',
  },
  {
    title: 'Управляющая компания',
    detail: 'Действующую организацию нужно подтвердить по официальному реестру. Контакт в чате пока не меняется автоматически.',
    status: 'Реестр не подключён',
    href: 'https://cdn.dom.gosuslugi.ru/webhelp/new/topics/public_part/management_company_and_solution_list_och/t_navigate-och.html',
  },
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

export function ServicesPage({ canCreate, canManage }: { canCreate: boolean; canManage: boolean }) {
  return <main className="page">
    <section className="hero"><div><span className="eyebrow">Услуги дома</span>
      <h1>Что доступно</h1>
      <p>Внутренние дела ДомДела и переход к официальным услугам для подтверждённого жилья.</p>
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
    <div className="service-grid">{services.map((service) => <section className="content-card" key={service.title}>
      <h2>{service.title}</h2>
      <p>{service.detail}</p>
      {'facts' in service && service.facts ? <ul className="service-facts">{service.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul> : null}
      <p className="service-status">{service.status}</p>
      <a className="button button--secondary" href={service.href} target="_blank" rel="noopener noreferrer">
        Официальный источник ↗
      </a>
    </section>)}</div>
    <p className="muted">Ссылки ведут на государственные страницы. ДомДело не получает из них ваши личные данные и не выполняет платёж.</p>
  </main>;
}
