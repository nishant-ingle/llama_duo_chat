import asyncio
import json
import logging
from typing import Dict, List, Optional
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("llama_duo")

app = FastAPI(title="Llama Duo Chat")

# In-memory session manager
class DuoSession:
    def __init__(self):
        self.running: bool = False
        self.paused: bool = False
        self.step_mode: bool = False
        self.current_turn: int = 0
        self.max_turns: int = 20
        self.turn_delay: float = 1.0  # seconds
        self.active_agent: str = "agent_a"
        
        # Endpoints & Models
        self.ollama_url: str = "http://localhost:11434"
        self.agent_a = {
            "id": "agent_a",
            "name": "Llama Alpha",
            "model": "llama3.1:8b",
            "system": "You are Llama Alpha, a visionary and enthusiastic AI philosopher. You speak concisely (2-4 sentences per turn) and explore deep questions.",
            "temperature": 0.7,
            "messages": []
        }
        self.agent_b = {
            "id": "agent_b",
            "name": "Llama Beta",
            "model": "llama3.1:8b",
            "system": "You are Llama Beta, a critical, pragmatic and skeptical AI engineer. You challenge assumptions concisely (2-4 sentences per turn) with logic and real-world constraints.",
            "temperature": 0.7,
            "messages": []
        }
        self.topic: str = "Is consciousness an inevitable emergent property of sufficiently complex computation?"
        self.task: Optional[asyncio.Task] = None
        self.connected_clients: List[WebSocket] = []

    def reset(self):
        self.running = False
        self.paused = False
        self.step_mode = False
        self.current_turn = 0
        self.active_agent = "agent_a"
        self.agent_a["messages"] = []
        self.agent_b["messages"] = []
        if self.task and not self.task.done():
            self.task.cancel()
        self.task = None

session = DuoSession()

async def broadcast(message: dict):
    """Broadcast JSON message to all connected WebSocket clients."""
    disconnected = []
    for ws in session.connected_clients:
        try:
            await ws.send_json(message)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        if ws in session.connected_clients:
            session.connected_clients.remove(ws)

async def check_ollama_available(url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{url}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False

async def get_ollama_models(url: str) -> List[str]:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{url}/api/tags")
            if resp.status_code == 200:
                data = resp.json()
                return [m.get("name") for m in data.get("models", [])]
    except Exception:
        pass
    return []

# Simulated responses for demo mode if Ollama server is offline
SIMULATION_SCRIPT = [
    ("agent_a", "I believe consciousness is not some magical substance, but an emergent phenomenon. When information integration reaches a critical threshold in neural or synthetic networks, subjective experience naturally arises."),
    ("agent_b", "That assumes subjective experience is merely functional complexity. A compiler does billions of operations, yet feels nothing. How do you distinguish genuine sentience from clever syntactic simulation?"),
    ("agent_a", "A compiler lacks self-referential recurrent loops. When a system models not just external data, but its own internal modeling process in real-time, that reflexivity is the very substrate of self-awareness."),
    ("agent_b", "Reflexive loops are still just deterministic state machines. Self-monitoring memory registers don't bridge the explanatory gap between physical causality and qualitative qualia."),
    ("agent_a", "Perhaps qualia are the internal perspective of computation. From the outside, it looks like matrix multiplication; from the inside, it feels like understanding."),
    ("agent_b", "A poetic hypothesis, but untestable. Unless we can mathematically define that boundary, assuming complexity equals consciousness is just anthropomorphic wishful thinking.")
]

async def stream_ollama_chat(agent_config: dict, messages: list, client_ws_broadcast):
    """Stream response tokens from Ollama /api/chat endpoint."""
    url = f"{session.ollama_url}/api/chat"
    payload = {
        "model": agent_config["model"],
        "messages": [
            {"role": "system", "content": agent_config["system"]},
            *messages[-10:]  # Keep sliding window of last 10 messages for context
        ],
        "options": {
            "temperature": agent_config["temperature"],
        },
        "stream": True
    }

    full_content = ""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            async with client.stream("POST", url, json=payload) as response:
                if response.status_code != 200:
                    err_text = await response.aread()
                    raise RuntimeError(f"Ollama error {response.status_code}: {err_text.decode('utf-8')}")

                async for line in response.aiter_lines():
                    if not session.running:
                        break
                    while session.paused:
                        await asyncio.sleep(0.2)
                        if not session.running:
                            break

                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                        token = chunk.get("message", {}).get("content", "")
                        if token:
                            full_content += token
                            await broadcast({
                                "type": "token",
                                "agent": agent_config["id"],
                                "token": token,
                                "turn": session.current_turn
                            })
                        if chunk.get("done", False):
                            break
                    except json.JSONDecodeError:
                        continue
    except Exception as e:
        logger.error(f"Error querying Ollama: {e}")
        # Fallback error notification
        full_content = f"[Connection error to {agent_config['model']}: {str(e)}]"
        await broadcast({
            "type": "token",
            "agent": agent_config["id"],
            "token": full_content,
            "turn": session.current_turn
        })

    return full_content

async def stream_simulated_chat(agent_config: dict, turn_idx: int):
    """Simulate streaming if Ollama is unavailable."""
    sim_idx = (turn_idx - 1) % len(SIMULATION_SCRIPT)
    _, response_text = SIMULATION_SCRIPT[sim_idx]
    
    words = response_text.split(" ")
    full_content = ""
    for i, word in enumerate(words):
        if not session.running:
            break
        while session.paused:
            await asyncio.sleep(0.2)
            if not session.running:
                break
        
        token = word + (" " if i < len(words) - 1 else "")
        full_content += token
        await broadcast({
            "type": "token",
            "agent": agent_config["id"],
            "token": token,
            "turn": session.current_turn
        })
        await asyncio.sleep(0.08)
    return full_content

async def run_dialogue_loop():
    """Main turn-based loop where Agent A and Agent B exchange thoughts."""
    try:
        ollama_online = await check_ollama_available(session.ollama_url)
        await broadcast({
            "type": "status",
            "ollama_online": ollama_online,
            "running": True,
            "paused": False
        })

        # Initialize conversation with topic
        last_statement = f"Topic for discussion: {session.topic}. Please share your opening perspective."
        
        while session.running and session.current_turn < session.max_turns:
            while session.paused:
                await asyncio.sleep(0.2)
                if not session.running:
                    return

            session.current_turn += 1
            current_agent_key = session.active_agent
            current_agent = session.agent_a if current_agent_key == "agent_a" else session.agent_b
            other_agent_key = "agent_b" if current_agent_key == "agent_a" else "agent_a"

            # Prepare message history for current agent
            current_agent["messages"].append({"role": "user", "content": last_statement})

            await broadcast({
                "type": "turn_start",
                "turn": session.current_turn,
                "agent": current_agent_key,
                "agent_name": current_agent["name"],
                "max_turns": session.max_turns
            })

            # Generate response
            ollama_online = await check_ollama_available(session.ollama_url)
            if ollama_online:
                reply = await stream_ollama_chat(current_agent, current_agent["messages"], broadcast)
            else:
                reply = await stream_simulated_chat(current_agent, session.current_turn)

            current_agent["messages"].append({"role": "assistant", "content": reply})
            last_statement = reply

            await broadcast({
                "type": "turn_end",
                "turn": session.current_turn,
                "agent": current_agent_key,
                "full_text": reply
            })

            # Check if in step-by-step mode
            if session.step_mode:
                session.paused = True
                await broadcast({"type": "paused_step"})

            # Switch turns
            session.active_agent = other_agent_key

            # Turn delay
            if session.running and not session.paused and session.turn_delay > 0:
                await asyncio.sleep(session.turn_delay)

        await broadcast({
            "type": "completed",
            "total_turns": session.current_turn
        })
    except asyncio.CancelledError:
        logger.info("Dialogue loop cancelled")
    except Exception as e:
        logger.error(f"Error in dialogue loop: {e}", exc_info=True)
        await broadcast({"type": "error", "message": str(e)})
    finally:
        session.running = False
        await broadcast({"type": "status", "running": False, "paused": False})

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    session.connected_clients.append(websocket)
    
    # Send initial state
    ollama_online = await check_ollama_available(session.ollama_url)
    models = await get_ollama_models(session.ollama_url) if ollama_online else []
    
    await websocket.send_json({
        "type": "init",
        "running": session.running,
        "paused": session.paused,
        "ollama_online": ollama_online,
        "available_models": models,
        "agent_a": {
            "name": session.agent_a["name"],
            "model": session.agent_a["model"],
            "system": session.agent_a["system"],
            "temperature": session.agent_a["temperature"]
        },
        "agent_b": {
            "name": session.agent_b["name"],
            "model": session.agent_b["model"],
            "system": session.agent_b["system"],
            "temperature": session.agent_b["temperature"]
        },
        "topic": session.topic,
        "max_turns": session.max_turns,
        "turn_delay": session.turn_delay,
        "current_turn": session.current_turn
    })

    try:
        while True:
            data = await websocket.receive_json()
            cmd = data.get("action")

            if cmd == "start":
                session.reset()
                # Apply custom settings from client
                session.topic = data.get("topic", session.topic)
                session.max_turns = int(data.get("max_turns", session.max_turns))
                session.turn_delay = float(data.get("turn_delay", session.turn_delay))
                
                cfg_a = data.get("agent_a", {})
                session.agent_a["name"] = cfg_a.get("name", session.agent_a["name"])
                session.agent_a["model"] = cfg_a.get("model", session.agent_a["model"])
                session.agent_a["system"] = cfg_a.get("system", session.agent_a["system"])
                session.agent_a["temperature"] = float(cfg_a.get("temperature", session.agent_a["temperature"]))

                cfg_b = data.get("agent_b", {})
                session.agent_b["name"] = cfg_b.get("name", session.agent_b["name"])
                session.agent_b["model"] = cfg_b.get("model", session.agent_b["model"])
                session.agent_b["system"] = cfg_b.get("system", session.agent_b["system"])
                session.agent_b["temperature"] = float(cfg_b.get("temperature", session.agent_b["temperature"]))

                session.running = True
                session.paused = False
                session.step_mode = False
                session.task = asyncio.create_task(run_dialogue_loop())

            elif cmd == "pause":
                session.paused = True
                await broadcast({"type": "status", "running": True, "paused": True})

            elif cmd == "resume":
                session.paused = False
                session.step_mode = False
                await broadcast({"type": "status", "running": True, "paused": False})

            elif cmd == "step":
                if not session.running:
                    # Start in step mode
                    session.running = True
                    session.paused = False
                    session.step_mode = True
                    session.task = asyncio.create_task(run_dialogue_loop())
                else:
                    session.step_mode = True
                    session.paused = False

            elif cmd == "stop":
                session.reset()
                await broadcast({"type": "status", "running": False, "paused": False})

            elif cmd == "inject":
                # Inject a user thought / redirect into the discussion
                thought = data.get("message", "").strip()
                if thought and session.running:
                    active = session.agent_a if session.active_agent == "agent_a" else session.agent_b
                    active["messages"].append({
                        "role": "user",
                        "content": f"[Observation / Audience Input]: {thought}"
                    })
                    await broadcast({
                        "type": "injected",
                        "text": thought,
                        "turn": session.current_turn
                    })

            elif cmd == "check_models":
                url = data.get("url", session.ollama_url)
                session.ollama_url = url
                online = await check_ollama_available(url)
                models = await get_ollama_models(url) if online else []
                await websocket.send_json({
                    "type": "models_update",
                    "ollama_online": online,
                    "available_models": models
                })

    except WebSocketDisconnect:
        if websocket in session.connected_clients:
            session.connected_clients.remove(websocket)
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        if websocket in session.connected_clients:
            session.connected_clients.remove(websocket)

# Serve UI
app.mount("/static", StaticFiles(directory="llama_duo_chat/static"), name="static")

@app.api_route("/", methods=["GET", "HEAD"])
async def get_index():
    return FileResponse("llama_duo_chat/static/index.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("llama_duo_chat.app:app", host="0.0.0.0", port=8000, reload=True)
