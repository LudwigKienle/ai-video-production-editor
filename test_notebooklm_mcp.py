import subprocess
import json
import sys

def verify():
    # Command to run the MCP server
    cmd = ["uv", "tool", "run", "--from", "notebooklm-mcp-server", "notebooklm-mcp"]

    # Start the process
    process = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr, # Pipe stderr to parent stderr
        text=True,
        bufsize=0 # Unbuffered for real-time interaction
    )

    try:
        # 1. Initialize
        init_req = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "manual-test", "version": "1.0"}
            }
        }
        process.stdin.write(json.dumps(init_req) + "\n")

        # Read initialize response
        while True:
            line = process.stdout.readline()
            if not line: break
            try:
                msg = json.loads(line)
                if msg.get("id") == 1:
                    # Got init response
                    break
            except:
                continue

        # 2. Send initialized notification
        process.stdin.write(json.dumps({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }) + "\n")

        # 3. List Resources
        list_req = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "resources/list"
        }
        process.stdin.write(json.dumps(list_req) + "\n")

        # Read list response
        while True:
            line = process.stdout.readline()
            if not line: break
            try:
                msg = json.loads(line)
                if msg.get("id") == 2:
                    print(json.dumps(msg, indent=2))
                    break
            except:
                continue

    except Exception as e:
        print(f"Error: {e}")
    finally:
        process.terminate()

if __name__ == "__main__":
    verify()
