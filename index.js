import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors({
    origin: "*"
}));

app.use("/img", express.static("img"));

// ===== CONFIG =====
const MOYSKLAD_API = "https://api.moysklad.ru/api/remap/1.2";

const headers = {
    Authorization: `Bearer ${process.env.MOYSKLAD_TOKEN}`,
    "Content-Type": "application/json",
};

// ImageMap
const imageMap = {
    "002d7461-01b1-11f1-0a80-0fda001056d8": "https://i.postimg.cc/ZnFFP44m/Photoroom-20260324-174803756.png",
    "2504a15d-cc58-11f0-0a80-177f003d79f9": "https://i.postimg.cc/ZnFFP44m/Photoroom-20260324-174803756.png",
};

// ===== CACHE =====
const CACHE_TTL = 5 * 60 * 1000; // 5 минут
let productsCache = null;
let productsCacheTime = 0;

// ===== ANTI-SPAM =====
let lastRequestTime = 0;

// ===== PRODUCTS =====
app.get("/products", async (req, res) => {
    const now = Date.now();
    console.log("➡️ /products запрос");

    // 🚫 защита от частых запросов
    if (now - lastRequestTime < 1000) {
        return res.status(429).json({ error: "Too many requests" });
    }
    lastRequestTime = now;

    // 📦 кеш
    if (productsCache && now - productsCacheTime < CACHE_TTL) {
        console.log("📦 FROM CACHE");
        return res.json(productsCache);
    }

    console.log("🌐 FROM MOYSKLAD");

    try {
        const { data } = await axios.get(
            `${MOYSKLAD_API}/entity/product`,
            {
                headers,
                params: {
                    limit: 50,
                    // expand: "images" ← пока НЕ используем (ломает стабильность)
                },
            }
        );

        const products = data.rows.map(item => ({
            id: item.id,
            title: item.name,
            price: item.salePrices?.[0]?.value
                ? item.salePrices[0].value / 100
                : 0,

            // ❗ пока без картинок (самый стабильный вариант)
            image: imageMap[item.id] || null,

            category: item.pathName
                ? item.pathName.split("/")[0]
                : "Без категории",

            inStock: !item.archived,
        }));

        productsCache = products;
        productsCacheTime = now;

        res.json(products);

    } catch (err) {
        console.error("❌ ERROR:", err.response?.data || err.message);
        res.status(500).json({ error: "Ошибка получения товаров" });
    }
});

// ===== TEST =====
app.get("/test", async (req, res) => {
    try {
        const response = await axios.get(
            `${MOYSKLAD_API}/entity/product?limit=1`,
            { headers }
        );

        res.json(response.data);
    } catch (e) {
        console.error("❌ TEST ERROR:", e.response?.data || e.message);
        res.status(500).json({
            error: "test failed",
            details: e.response?.data || e.message,
        });
    }
});



// ===== IMAGE CACHE =====
const imageCache = new Map();

app.get("/image/:id", async (req, res) => {
    const { id } = req.params;

    try {
        // если есть в кеше — отдаём сразу
        if (imageCache.has(id)) {
            console.log("🖼 FROM CACHE:", id);
            const cached = imageCache.get(id);

            res.setHeader("Content-Type", cached.contentType);
            return res.send(cached.buffer);
        }

        console.log("🌐 LOAD IMAGE:", id);

        // получаем товар с картинкой
        const { data } = await axios.get(
            `${MOYSKLAD_API}/entity/product/${id}`,
            {
                headers,
                params: { expand: "images" }
            }
        );

        const imageMeta = data.images?.rows?.[0]?.meta;

        if (!imageMeta) {
            return res.status(404).send("No image");
        }

        // скачиваем картинку
        const imageResponse = await axios.get(imageMeta.downloadHref, {
            headers,
            responseType: "arraybuffer"
        });

        const buffer = Buffer.from(imageResponse.data);
        const contentType = imageResponse.headers["content-type"];

        // сохраняем в кеш
        imageCache.set(id, {
            buffer,
            contentType,
            time: Date.now()
        });

        res.setHeader("Content-Type", contentType);
        res.send(buffer);

    } catch (err) {
        console.error("❌ IMAGE ERROR:", err.message);
        res.status(500).send("Error loading image");
    }
});


// ===== START =====
app.listen(process.env.PORT || 3000, () => {
    console.log("🚀 GAMMA backend запущен");
});
