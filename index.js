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

// ImageMap
const imageMap = {
    "002d7461-01b1-11f1-0a80-0fda001056d8": "https://i.postimg.cc/ZnFFP44m/Photoroom-20260324-174803756.png",
    "2504a15d-cc58-11f0-0a80-177f003d79f9": "https://i.postimg.cc/ZnFFP44m/Photoroom-20260324-174803756.png",
};

// ===== CACHE =====
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let productsCache = null;
let productsCacheTime = 0;

// ===== ANTI-SPAM =====
let lastRequestTime = 0;

// ===== PRODUCTS =====
app.get("/products", async (req, res) => {
    const now = Date.now();
    console.log("Request: /products");
    console.log("TOKEN:", process.env.MOYSKLAD_TOKEN);

    if (!process.env.MOYSKLAD_TOKEN) {
        return res.status(500).json({ error: "No token" });
    }

    const headers = {
        Authorization: `Bearer ${process.env.MOYSKLAD_TOKEN}`,
        "Content-Type": "application/json"
    };

    // Anti-spam protection
    if (now - lastRequestTime < 1000) {
        return res.status(429).json({ error: "Too many requests" });
    }
    lastRequestTime = now;

    // Cache
    if (productsCache && now - productsCacheTime < CACHE_TTL) {
        console.log("FROM CACHE");
        return res.json(productsCache);
    }

    console.log("FROM MOYSKLAD");

    try {
        const { data } = await axios.get(
            `${MOYSKLAD_API}/entity/product`,
            {
                headers,
                params: {
                    limit: 50,
                    // expand: "images" disabled for stability
                },
            }
        );

        const products = data.rows.map(item => ({
            id: item.id,
            title: item.name,
            price: item.salePrices?.[0]?.value
                ? item.salePrices[0].value / 100
                : 0,

            // Stable option without image expansion
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
        console.error("ERROR:", err.response?.data || err.message);
        res.status(500).json({ error: "Ошибка получения товаров" });
    }
});

// ===== TEST =====
app.get("/test", async (req, res) => {
    console.log("TOKEN:", process.env.MOYSKLAD_TOKEN);

    if (!process.env.MOYSKLAD_TOKEN) {
        return res.status(500).json({ error: "No token" });
    }

    const headers = {
        Authorization: `Bearer ${process.env.MOYSKLAD_TOKEN}`,
        "Content-Type": "application/json"
    };

    try {
        const response = await axios.get(
            `${MOYSKLAD_API}/entity/product?limit=1`,
            { headers }
        );

        res.json(response.data);
    } catch (e) {
        console.error("TEST ERROR:", e.response?.data || e.message);
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
    console.log("TOKEN:", process.env.MOYSKLAD_TOKEN);

    if (!process.env.MOYSKLAD_TOKEN) {
        return res.status(500).json({ error: "No token" });
    }

    const headers = {
        Authorization: `Bearer ${process.env.MOYSKLAD_TOKEN}`,
        "Content-Type": "application/json"
    };

    try {
        // Return cached image immediately if present
        if (imageCache.has(id)) {
            console.log("IMAGE FROM CACHE:", id);
            const cached = imageCache.get(id);

            res.setHeader("Content-Type", cached.contentType);
            return res.send(cached.buffer);
        }

        console.log("LOAD IMAGE:", id);

        // Load product with expanded images
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

        // Download image binary
        const imageResponse = await axios.get(imageMeta.downloadHref, {
            headers,
            responseType: "arraybuffer"
        });

        const buffer = Buffer.from(imageResponse.data);
        const contentType = imageResponse.headers["content-type"];

        // Save image to cache
        imageCache.set(id, {
            buffer,
            contentType,
            time: Date.now()
        });

        res.setHeader("Content-Type", contentType);
        res.send(buffer);

    } catch (err) {
        console.error("IMAGE ERROR:", err.message);
        res.status(500).send("Error loading image");
    }
});


// ===== START =====
app.listen(process.env.PORT || 3000, () => {
    console.log("GAMMA backend started");
});
