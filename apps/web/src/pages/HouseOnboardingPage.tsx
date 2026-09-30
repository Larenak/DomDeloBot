import { HouseAddressForm } from '../components/HouseAddressForm.js';
import { InviteRegistrationForm } from '../components/InviteRegistrationForm.js';

export function HouseOnboardingPage() {
  return (
    <main className="address-onboarding">
      <section className="address-onboarding__intro">
        <span className="brand__mark">Д</span>
        <span className="eyebrow">Первый шаг</span>
        <h1>Регистрация в доме</h1>
        <p>
          {window.WebApp?.initData
            ? 'Добавьте адрес без кода, чтобы открыть дела дома. Диспетчер и исполнитель могут ввести служебный код.'
            : 'Выберите адрес демонстрационного дома, чтобы посмотреть сценарий жильца, диспетчера и исполнителя.'}
        </p>
      </section>
      <section className="form-card address-onboarding__form">
        <h2>Адрес дома</h2>
        <HouseAddressForm />
      </section>
      <InviteRegistrationForm />
    </main>
  );
}
