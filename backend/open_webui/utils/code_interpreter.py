import asyncio
import json
import logging
import uuid
from typing import Optional, Dict, Any

import aiohttp
import websockets
from pydantic import BaseModel
import time

from open_webui.env import SRC_LOG_LEVELS

logger = logging.getLogger(__name__)
logger.setLevel(SRC_LOG_LEVELS["MAIN"])


class ResultModel(BaseModel):
    """
    Execute Code Result Model
    """

    stdout: Optional[str] = ""
    stderr: Optional[str] = ""
    result: Optional[str] = ""


class JupyterCodeExecuter:
    """
    Execute code in jupyter notebook
    """

    def __init__(
        self,
        base_url: str,
        code: str,
        token: str = "",
        password: str = "",
        timeout: int = 60,
    ):
        """
        :param base_url: Jupyter server URL (e.g., "http://localhost:8888")
        :param code: Code to execute
        :param token: Jupyter authentication token (optional)
        :param password: Jupyter password (optional)
        :param timeout: WebSocket timeout in seconds (default: 60s)
        """
        self.base_url = base_url
        self.code = code
        self.token = token
        self.password = password
        self.timeout = timeout
        self.kernel_id = ""
        if self.base_url[-1] != "/":
            self.base_url += "/"
        self.session = aiohttp.ClientSession(trust_env=True, base_url=self.base_url)
        self.params = {}
        self.result = ResultModel()

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.kernel_id:
            try:
                async with self.session.delete(
                    f"api/kernels/{self.kernel_id}", params=self.params
                ) as response:
                    response.raise_for_status()
            except Exception as err:
                logger.exception("close kernel failed, %s", err)
        await self.session.close()

    async def run(self) -> ResultModel:
        try:
            await self.sign_in()
            await self.init_kernel()
            await self.execute_code()
        except Exception as err:
            logger.exception("execute code failed, %s", err)
            self.result.stderr = f"Error: {err}"
        return self.result

    async def sign_in(self) -> None:
        # password authentication
        if self.password and not self.token:
            async with self.session.get("login") as response:
                response.raise_for_status()
                xsrf_token = response.cookies["_xsrf"].value
                if not xsrf_token:
                    raise ValueError("_xsrf token not found")
                self.session.cookie_jar.update_cookies(response.cookies)
                self.session.headers.update({"X-XSRFToken": xsrf_token})
            async with self.session.post(
                "login",
                data={"_xsrf": xsrf_token, "password": self.password},
                allow_redirects=False,
            ) as response:
                response.raise_for_status()
                self.session.cookie_jar.update_cookies(response.cookies)

        # token authentication
        if self.token:
            self.params.update({"token": self.token})

    async def init_kernel(self) -> None:
        async with self.session.post(url="api/kernels", params=self.params) as response:
            response.raise_for_status()
            kernel_data = await response.json()
            self.kernel_id = kernel_data["id"]

    def init_ws(self) -> (str, dict):
        ws_base = self.base_url.replace("http", "ws", 1)
        ws_params = "?" + "&".join([f"{key}={val}" for key, val in self.params.items()])
        websocket_url = f"{ws_base}api/kernels/{self.kernel_id}/channels{ws_params if len(ws_params) > 1 else ''}"
        ws_headers = {}
        if self.password and not self.token:
            ws_headers = {
                "Cookie": "; ".join(
                    [
                        f"{cookie.key}={cookie.value}"
                        for cookie in self.session.cookie_jar
                    ]
                ),
                **self.session.headers,
            }
        return websocket_url, ws_headers

    async def execute_code(self) -> None:
        # initialize ws
        websocket_url, ws_headers = self.init_ws()
        # execute
        async with websockets.connect(
            websocket_url, additional_headers=ws_headers
        ) as ws:
            await self.execute_in_jupyter(ws)

    async def execute_in_jupyter(self, ws) -> None:
        # send message
        msg_id = uuid.uuid4().hex
        await ws.send(
            json.dumps(
                {
                    "header": {
                        "msg_id": msg_id,
                        "msg_type": "execute_request",
                        "username": "user",
                        "session": uuid.uuid4().hex,
                        "date": "",
                        "version": "5.3",
                    },
                    "parent_header": {},
                    "metadata": {},
                    "content": {
                        "code": self.code,
                        "silent": False,
                        "store_history": True,
                        "user_expressions": {},
                        "allow_stdin": False,
                        "stop_on_error": True,
                    },
                    "channel": "shell",
                }
            )
        )
        # parse message
        stdout, stderr, result = "", "", []
        while True:
            try:
                # wait for message
                message = await asyncio.wait_for(ws.recv(), self.timeout)
                message_data = json.loads(message)
                # msg id not match, skip
                if message_data.get("parent_header", {}).get("msg_id") != msg_id:
                    continue
                # check message type
                msg_type = message_data.get("msg_type")
                match msg_type:
                    case "stream":
                        if message_data["content"]["name"] == "stdout":
                            stdout += message_data["content"]["text"]
                        elif message_data["content"]["name"] == "stderr":
                            stderr += message_data["content"]["text"]
                    case "execute_result" | "display_data":
                        data = message_data["content"]["data"]
                        if "image/png" in data:
                            result.append(f"data:image/png;base64,{data['image/png']}")
                        elif "text/plain" in data:
                            result.append(data["text/plain"])
                    case "error":
                        stderr += "\n".join(message_data["content"]["traceback"])
                    case "status":
                        if message_data["content"]["execution_state"] == "idle":
                            break

            except asyncio.TimeoutError:
                stderr += "\nExecution timed out."
                break
        self.result.stdout = stdout.strip()
        self.result.stderr = stderr.strip()
        self.result.result = "\n".join(result).strip() if result else ""

    async def add_cell_to_jupyter_notebook(self, jupyter_notebook_filename: str, output: Optional[dict] = None) -> Dict[str, Any]:
        """Add code as new cell to notebook using existing session"""
        try:
            await self.sign_in()  # Reuse existing authentication
            
            # Try to get existing notebook
            jupyter_notebook_content = await self.get_or_create_jupyter_notebook(jupyter_notebook_filename)
            
            outputs = []
            
            if output:
                if output.get('stderr'):
                    outputs.append({
                        "output_type": "stream", 
                        "name": "stderr",
                        "text": output['stderr']
                    })

                if output.get('stdout'):
                    outputs.append({
                        "output_type": "stream",
                        "name": "stdout", 
                        "text": output['stdout']
                    })
                
                if output.get('result'):
                    # Parse result field which may contain mixed content
                    result_lines = output['result'].split('\n') if output['result'] else []
                    data = {}
                    
                    for line in result_lines:
                        if line.startswith('data:image/png;base64,'):
                            # Extract base64 part
                            base64_data = line.replace('data:image/png;base64,', '')
                            data["image/png"] = base64_data
                        elif line.strip():  # Non-empty text line
                            if "text/plain" not in data:
                                data["text/plain"] = []
                            data["text/plain"].append(line)
                    
                    if data:
                        # Join text lines if any
                        if "text/plain" in data:
                            data["text/plain"] = '\n'.join(data["text/plain"])
                        
                        outputs.append({
                            "output_type": "execute_result",
                            "execution_count": 1,
                            "data": data,
                            "metadata": {}
                        })
            
            # Add new code cell
            jupyter_new_cell = {
                "cell_type": "code",
                "execution_count": 1 if outputs else None,
                "id": str(uuid.uuid4()),
                "metadata": {
                    "jupyter_created_from_chat": True,
                    "jupyter_chat_timestamp": time.time()
                },
                "outputs": outputs,
                "source": self.code
            }
            
            jupyter_notebook_content["cells"].append(jupyter_new_cell)
            
            # Save notebook back
            await self.save_jupyter_notebook_with_new_cell(jupyter_notebook_filename, jupyter_notebook_content)
            
            return {"success": True, "jupyter_cell_id": jupyter_new_cell["id"]}
            
        except Exception as err:
            logger.exception("add cell to jupyter notebook failed, %s", err)
            raise err

    async def get_or_create_jupyter_notebook(self, jupyter_notebook_filename: str) -> Dict[str, Any]:
        """Get existing notebook or create new one"""
        try:
            async with self.session.get(
                f"api/contents/{jupyter_notebook_filename.lstrip('/')}", 
                params=self.params  # Reuse existing params
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    return data["content"]
                elif response.status == 404:
                    return self.create_empty_jupyter_notebook()
                else:
                    response.raise_for_status()
        except Exception:
            return self.create_empty_jupyter_notebook()

    def create_empty_jupyter_notebook(self) -> Dict[str, Any]:
        """Create empty notebook structure"""
        return {
            "cells": [],
            "metadata": {
                "kernelspec": {
                    "display_name": "Python 3",
                    "language": "python",
                    "name": "python3"
                },
                "language_info": {
                    "name": "python"
                    # Version omitted - let Jupyter determine it automatically
                }
            },
            "nbformat": 4,
            "nbformat_minor": 4
        }

    async def save_jupyter_notebook_with_new_cell(self, jupyter_notebook_filename: str, jupyter_notebook_content: Dict[str, Any]) -> None:
        """Add cell to existing notebook or create new notebook with cell"""
        jupyter_notebook_data = {
            "type": "notebook", 
            "format": "json",
            "content": jupyter_notebook_content
        }
        
        async with self.session.put(
            f"api/contents/{jupyter_notebook_filename.lstrip('/')}",
            params=self.params,  # Reuse existing params and auth
            json=jupyter_notebook_data
        ) as response:
            response.raise_for_status()


async def execute_code_jupyter(
    base_url: str, code: str, token: str = "", password: str = "", timeout: int = 60
) -> dict:
    async with JupyterCodeExecuter(
        base_url, code, token, password, timeout
    ) as executor:
        result = await executor.run()
        return result.model_dump()

async def add_cell_to_jupyter_notebook(
    jupyter_base_url: str, 
    code: str, 
    jupyter_notebook_filename: str, 
    jupyter_auth_token: str = "", 
    jupyter_auth_password: str = "",
    output: Optional[dict] = None
) -> dict:
    """Add code cell to Jupyter notebook using existing JupyterCodeExecuter"""
    async with JupyterCodeExecuter(
        jupyter_base_url, code, jupyter_auth_token, jupyter_auth_password
    ) as executor:
        result = await executor.add_cell_to_jupyter_notebook(jupyter_notebook_filename, output)
        return result
