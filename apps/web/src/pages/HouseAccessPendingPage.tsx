import { DemoHouseButton } from '../components/DemoHouseButton.js';
import type { HouseContextDto } from '@domdelo/contracts';
import { InviteRegistrationForm } from '../components/InviteRegistrationForm.js';

export function HouseAccessPendingPage({ houses, demoHouseAvailable }: { houses: HouseContextDto['houses']; demoHouseAvailable: boolean }) {
  return <main className="address-onboarding">
    <section className="address-onboarding__intro">
      <span className="brand__mark">Д</span>
      <span className="eyebrow">Проверка доступа</span>
      <h1>Дом добавлен</h1>
      <p>Адрес найден, но право доступа к делам дома ещё не подтверждено.</p>
    </section>
    <section className="form-card address-onboarding__form">
      <h2>Ваши адреса</h2>
      <ul>{houses.map((house) => <li key={house.id}>{house.address}</li>)}</ul>
      <p>После проверки проживания получите личный код и введите его ниже. Добавление адреса само по себе не подтверждает право проживания.</p>
      {demoHouseAvailable ? <DemoHouseButton /> : null}
    </section>
    <InviteRegistrationForm />
  </main>;
}