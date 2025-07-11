# PricePilot API 🛒

A powerful price comparison API that aggregates product prices from Walmart and Target in real-time. Built with Node.js, Express, and Redis for optimal performance and caching.

## ✨ Features

- **Multi-Store Search**: Search across Walmart and Target simultaneously
- **Location-Based Pricing**: Get store-specific prices based on your location
- **Smart Caching**: Redis-powered caching for faster responses
- **Rate Limiting**: Built-in protection against abuse

## 🚀 API Endpoints

### Search Products
```
GET /search?item=laptop&lat=40.7128&lon=-74.0060&zip=10001
```

**Parameters:**
- `item` (required): Product to search for
- `lat` (optional): Latitude for location-based pricing
- `lon` (optional): Longitude for location-based pricing  
- `zip` (optional): ZIP code for store location

**Response:**
```json
[
  {
    "store": "Walmart",
    "name": "HP Pavilion Laptop",
    "price": "899.99",
    "url": "https://walmart.com/product",
    "image": "https://walmart.com/image.jpg"
  },
  {
    "store": "Target",
    "name": "Dell Inspiron Laptop", 
    "price": "999.99",
    "url": "https://target.com/product",
    "image": "https://target.com/image.jpg"
  }
]
```

### Health Check
```
GET /health
```

## 🛠️ Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/pricepilot-api.git
cd pricepilot-api
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Required environment variables:
- `CONSUMER_ID`: Walmart API consumer ID
- `PRIVATE_KEY_BASE64`: Walmart API private key
- `REDIS_URL`: Redis connection URL
- `PORT`: Server port (default: 5000)

4. Start the server:
```bash
npm start
```

## 🛡️ Security Features

- Input validation and sanitization
- Rate limiting (30 requests/minute per IP)
- Security headers (XSS protection, CSRF, etc.)
- Error handling without information leakage
- Request size limiting
- Comprehensive logging

## 📊 Performance

- **Caching**: 2-minute cache for search results
- **Concurrent Requests**: Parallel scraping across stores
- **Timeout Handling**: 10-15 second timeouts per store
- **Retry Logic**: Automatic retry for failed requests

## 🏪 Supported Stores

### Walmart  
- Official API integration
- Location-based store selection
- Installment plan calculation
- Product image handling

### Target
- RedSky API integration
- ZIP code-based store selection
- Product metadata extraction


## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

This API is for educational and demonstration purposes. Please ensure compliance with each store's terms of service and API usage policies before using in production.

## 📞 Support

For questions or support, please open an issue on GitHub