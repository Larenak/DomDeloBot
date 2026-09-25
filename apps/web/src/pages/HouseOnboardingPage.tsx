import { HouseAddressForm } from '../components/HouseAddressForm.js';

export function HouseOnboardingPage() {
  return (
    <main className="address-onboarding">
      <section className="address-onboarding__intro">
        <span className="brand__mark">Д</span>
        <span className="eyebrow">Первый шаг</span>
        <h1>Добавьте свой дом</h1>
        <p>
          Дела, соседи и ответственные организации разделяются по адресу. Можно добавить
          несколько домов и переключаться между ними.
        </p>
      </section>
      <section className="form-card address-onboarding__form">
        <h2>Адрес дома</h2>
        <HouseAddressForm />
      </section>
    </main>
  );
}
