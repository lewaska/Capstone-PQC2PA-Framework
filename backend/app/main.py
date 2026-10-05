from app.api.routes.assets import router as assets_router
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="PQ-C2PA Web Framework API",
    version="1.0.0",
)
app.include_router(assets_router, prefix="/api/v1")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "api_version": "v1",
        "pq_core_mode": "mock",
    }