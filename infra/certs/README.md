# Сертификат для MAX API

`russian_trusted_root_ca.cer` загружен с официального ресурса Госуслуг:

`https://gu-st.ru/content/Other/doc/russian_trusted_root_ca.cer`

Проверенные параметры файла:

- Subject: `C=RU, O=The Ministry of Digital Development and Communications, CN=Russian Trusted Root CA`
- SHA-256: `D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31`
- Срок действия: 1 марта 2022 — 27 февраля 2032

Сертификат не устанавливается в системное хранилище Windows. Процесс Node.js получает его
через `NODE_EXTRA_CA_CERTS`, поэтому настройка действует только для запущенного бота.
