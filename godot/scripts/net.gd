class_name UnoNet
extends RefCounted

## Online-Partie: derselbe Draht wie im Browser.
##
## Der Server (uno/server/server.js) fuehrt das Spiel und schickt jeder
## Person nur ihre eigene Sicht. Hier laufen dieselben JSON-Nachrichten
## ueber einen WebSocket.

signal welcomed(code: String, you: String)
signal lobby_changed(lobby: Dictionary)
signal state_changed(view: Dictionary)
signal failed(message: String)
signal noticed(message: String)
signal closed(message: String)

var socket := WebSocketPeer.new()
var url := ""
var connected := false
var code := ""
var you := ""
var token := ""
var _queue: Array[String] = []
var _was_open := false


func connect_to_server(server_url: String) -> void:
	url = server_url
	var err := socket.connect_to_url(url)
	if err != OK:
		failed.emit("Keine Verbindung zu %s." % url)


## Muss jeden Frame aufgerufen werden - der WebSocket wird selbst gepumpt.
func poll() -> void:
	if url.is_empty():
		return
	socket.poll()
	var state := socket.get_ready_state()

	match state:
		WebSocketPeer.STATE_OPEN:
			if not _was_open:
				_was_open = true
				connected = true
				for msg in _queue:
					socket.send_text(msg)
				_queue.clear()
			while socket.get_available_packet_count() > 0:
				_receive(socket.get_packet().get_string_from_utf8())
		WebSocketPeer.STATE_CLOSED:
			if _was_open:
				_was_open = false
				connected = false
				closed.emit("Die Verbindung wurde beendet.")
				url = ""


func _receive(raw: String) -> void:
	var msg = JSON.parse_string(raw)
	if typeof(msg) != TYPE_DICTIONARY:
		return
	match msg.get("t", ""):
		"welcome":
			code = msg.get("code", "")
			you = msg.get("you", "")
			token = msg.get("token", "")
			welcomed.emit(code, you)
		"lobby":
			lobby_changed.emit(msg)
		"state":
			state_changed.emit(msg.get("view", {}))
		"error":
			failed.emit(msg.get("message", "Das ging nicht."))
		"toast":
			noticed.emit(msg.get("message", ""))
		"closed":
			closed.emit(msg.get("message", "Der Raum wurde geschlossen."))
		_:
			pass


func send(msg: Dictionary) -> void:
	var text := JSON.stringify(msg)
	if connected and socket.get_ready_state() == WebSocketPeer.STATE_OPEN:
		socket.send_text(text)
	else:
		_queue.append(text)


func create_room(name: String, options: Dictionary) -> void:
	send({"t": "create", "name": name, "options": options})


func join_room(room_code: String, name: String) -> void:
	send({"t": "join", "code": room_code, "name": name})


func add_bot(level: String = "normal") -> void:
	send({"t": "addbot", "level": level})


func remove_bot() -> void:
	send({"t": "rmbot"})


func set_options(options: Dictionary) -> void:
	send({"t": "options", "options": options})


func start_game() -> void:
	send({"t": "start"})


func play(action: Dictionary) -> void:
	send({"t": "action", "action": action})


func leave() -> void:
	if connected:
		send({"t": "leave"})
	socket.close()
	url = ""
	connected = false
	_was_open = false
