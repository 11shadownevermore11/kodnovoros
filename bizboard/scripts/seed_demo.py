"""Populate the isolated demo database with fictional B2B listings."""
import asyncio
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select

from app.core.config import settings
from app.core.database import SessionLocal, engine
from app.core.utils import utcnow
from app.models.catalog import Category
from app.models.enums import ListingStatus, ListingType, Region
from app.models.listing import Listing
from app.models.organization import Organization
from app.models.user import User
from app.schemas.organization import OrgCreate
from app.services.org_service import create_organization

OFFERS = [
    ("kommercheskaya-nedvizhimost", "rent_out", "dnr", "Донецк", "Складской блок 480 м²",
     "Отдельный въезд для грузового транспорта, круглосуточный доступ и отапливаемая зона комплектования.", 125000, "мес.", {"area": 480, "ceiling_height": 6, "utilities": True, "purpose": "warehouse"}),
    ("logistika-i-perevozki", "service_offer", "lnr", "Луганск", "Сборные грузы для малого бизнеса",
     "Забираем небольшие партии со склада и доставляем получателям. Есть фотоотчёт о погрузке и отслеживание.", 12000, "рейс", {"transport_type": "van", "capacity_t": 2, "route": "Луганск и область"}),
    ("oborudovanie", "sale", "dnr", "Мариуполь", "Линия упаковки для пищевого цеха",
     "Полуавтоматическая линия для фасовки продукции. В комплекте запайщик и набор сменных форматов.", 285000, None, {"condition": "used", "year": 2023, "power_kw": 3.5}),
    ("reklama-i-marketing", "service_offer", "zaporozhye", "Мелитополь", "Айдентика для локальных брендов",
     "Разработаем логотип, упаковку и шаблоны для соцсетей. Подготовим исходники и файлы для печати.", 49000, "проект", {"service_format": "hybrid", "deadline_days": 21}),
    ("uslugi-dlya-biznesa", "tender", "kherson", None, "Монтаж холодильной камеры",
     "Ищем подрядчика для установки камеры и пусконаладки. Работы по проекту, техническое задание по запросу.", None, None, {"service_format": "onsite"}),
    ("tovary-i-syryo-opt", "sale", "dnr", "Донецк", "Крафтовая упаковка оптом",
     "Коробки и пакеты для кафе, магазинов и доставки. Минимальная партия 500 единиц, возможно нанесение логотипа.", 38, "шт.", {"volume": 500, "packaging": "Гофрокартон"}),
    ("gotovyy-biznes-i-franshizy", "partnership", "dnr", "Донецк", "Партнёрство для сети кофеен",
     "Ищем партнёра для новой точки. Поможем с выбором формата, закупкой оборудования и обучением команды.", None, None, {}),
    ("transport-i-spectehnika", "rent_out", "lnr", "Луганск", "Аренда вилочного погрузчика",
     "Погрузчик для складских работ и разгрузки машин. Доставим на площадку, возможна аренда со специалистом.", 6500, "смена", {"capacity_t": 2.5, "year": 2022}),
]


async def main():
    if not settings.demo_enabled:
        raise SystemExit("Для наполнения включите изолированный демо-режим BizBoard.")
    try:
        async with SessionLocal() as db:
            user = await db.scalar(select(User).where(User.telegram_id == -1))
            if user is None:
                user = User(telegram_id=-1, first_name="Команда демо", notification_settings={})
                db.add(user)
                await db.commit()
            org = await db.scalar(select(Organization).where(Organization.slug == "demo-bizboard"))
            if org is None:
                org = await create_organization(db, user, OrgCreate(
                    name="Демо-компания BizBoard", slug="demo-bizboard", type="legal_entity", region="dnr",
                    description="Вымышленная компания для демонстрации работы платформы.",
                ))
            now = utcnow()
            for index, (slug, kind, region, city, title, description, price, unit, attrs) in enumerate(OFFERS, 1):
                listing_id = UUID(f"bcdb0000-0000-4000-8000-{index:012d}")
                if await db.get(Listing, listing_id) is not None:
                    continue
                category = await db.scalar(select(Category).where(Category.slug == slug))
                db.add(Listing(
                    id=listing_id, title=title, description=description, category_id=category.id,
                    type=ListingType(kind), region=Region(region), city=city,
                    price=Decimal(price) if price is not None else None, currency="RUB", price_unit=unit,
                    negotiable=price is None, attributes=attrs, status=ListingStatus.ACTIVE,
                    user_id=user.id, organization_id=org.id, is_private_person=False,
                    published_at=now,
                    contact_phone="+12025550101" if index == 1 else None,
                ))
            await db.commit()
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
