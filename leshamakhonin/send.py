import sys, asyncio
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from telethon import TelegramClient

API_ID = 32687502
API_HASH = "ca1e62132abe7db4c62e5a5bac2d22b5"
SESSION = "G:/Claude/telegram-agent/sales_agent"
TARGET = "leshamakhonin"

MSG = """Леша, привіт!

Побачив твою карусель про 8 думок — дуже зайшла ідея і форма. Взяв як експеримент — переверстав твій же контент в іншому візуальному стилі (стиль однієї з каруселей, яку я недавно бачив — paper-note + жовті акценти).

Тексти твої, змінив тільки подачу. Скидаю подивитись — як варіант іншої обгортки під той самий матеріал.
Якщо зайде — роби, не зайде — просто цікавий тест 🙂"""

async def main():
    client = TelegramClient(SESSION, API_ID, API_HASH)
    await client.start()
    print("Connected!")

    entity = await client.get_entity(TARGET)
    print(f"Found: {entity.first_name} (@{TARGET})")

    files = [f"G:/Claude/carousels/leshamakhonin/slide_{i:02d}.jpg" for i in range(1, 10)]
    await client.send_file(entity, files, caption=MSG)
    print("Sent carousel (9 slides) with caption")

    await client.disconnect()
    print("DONE")

asyncio.run(main())
