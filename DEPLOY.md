# Deploy VN Quant lên Vercel (không cần Python)

## Vì sao không dùng vnstock trên Vercel?
- `vnstock` là thư viện **Python**, không chạy trong browser.
- Máy chặn Python / app static trên Vercel → không chạy được vnstock trực tiếp.
- Giải pháp: **Serverless API** (`/api/ohlcv`) trên Vercel gọi **iTick** (token lưu trên server).

## 1. Lấy iTick token (free)
1. Đăng ký: https://www.itick.org
2. Console → copy API Token

## 2. Đẩy code lên GitHub
```bash
cd quant-trading-web
git init
git add .
git commit -m "VN Quant + Vercel API proxy"
# tạo repo trên GitHub rồi:
git remote add origin https://github.com/<USER>/<REPO>.git
git branch -M main
git push -u origin main
```

## 3. Import Vercel
1. https://vercel.com → Add New Project → chọn repo
2. Framework: Vite
3. Build: `npm run build` · Output: `dist`
4. **Environment Variables** thêm:
   - Name: `ITICK_TOKEN`
   - Value: (token iTick)
   - Environment: Production, Preview
5. Deploy

## 4. Cấu hình app sau khi có URL
Ví dụ URL: `https://your-app.vercel.app`

1. Mở site → **Settings**
2. Provider: **Generic HTTP**
3. Base URL: `https://your-app.vercel.app/api`  
   (provider gọi `{base}/ohlcv?symbol=...`)
4. API key: để trống (token nằm trên server)
5. Save → Clear cache → **T+ Scanner → Force Refresh**

## 5. Kiểm tra API
```
https://your-app.vercel.app/api/health
https://your-app.vercel.app/api/ohlcv?symbol=VCB&start=2025-01-01&end=2026-10-08
```

## Local (không Python)
- Vẫn dùng Mock, hoặc iTick token trong Settings (provider iTick) nếu CORS cho phép.
- Serverless `/api/*` chỉ có trên Vercel (hoặc `vercel dev` nếu cài Vercel CLI).

## Lưu ý
- Free iTick có rate limit → scan universe nhỏ / custom list.
- Không commit token vào git.
- Không phải lời khuyên đầu tư.
