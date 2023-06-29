import { io } from "socket.io-client";

frappe.provide("frappe.realtime");

class RealTimeClient {
	constructor() {
		this.open_tasks = {};
		this.open_docs = [];
		this.emit_queue = [];
	}

	on(event, callback) {
		if (this.socket) {
			this.socket.on(event, callback);
		}
	}

	off(event, callback) {
		if (this.socket) {
			this.socket.off(event, callback);
		}
	}

	init(port = 9000) {
		if (frappe.boot.disable_async) {
			return;
		}

		if (this.socket) {
			return;
		}

		let me = this;

		// Enable secure option when using HTTPS
		if (window.location.protocol == "https:") {
			this.socket = io.connect(this.get_host(port), {
				secure: true,
				withCredentials: true,
				reconnectionAttempts: 3,
			});
		} else if (window.location.protocol == "http:") {
			this.socket = io.connect(this.get_host(port), {
				withCredentials: true,
				reconnectionAttempts: 3,
			});
		}

		if (!this.socket) {
			console.log("Unable to connect to " + this.get_host(port));
			return;
		}

		this.socket.on("msgprint", function (message) {
			frappe.msgprint(message);
		});

		this.socket.on("progress", function (data) {
			if (data.progress) {
				data.percent = (flt(data.progress[0]) / data.progress[1]) * 100;
			}
			if (data.percent) {
				frappe.show_progress(
					data.title || __("Progress"),
					data.percent,
					100,
					data.description,
					true
				);
			}
		});

		this.setup_listeners();

		$(document).on("form-load form-rename", function (e, frm) {
			if (!frm.doc || frm.is_new()) {
				return;
			}

			for (var i = 0, l = me.open_docs.length; i < l; i++) {
				var d = me.open_docs[i];
				if (frm.doctype == d.doctype && frm.docname == d.name) {
					// already subscribed
					return false;
				}
			}

			me.doc_subscribe(frm.doctype, frm.docname);
		});

		$(document).on("form-refresh", function (e, frm) {
			if (!frm.doc || frm.is_new()) {
				return;
			}
			me.doc_open(frm.doctype, frm.docname);
		});

		$(document).on("form-unload", function (e, frm) {
			if (!frm.doc || frm.is_new()) {
				return;
			}

			// me.doc_unsubscribe(frm.doctype, frm.docname);
			me.doc_close(frm.doctype, frm.docname);
		});

		$(document).on("form-typing", function (e, frm) {
			me.form_typing(frm.doctype, frm.docname);
		});

		$(document).on("form-stopped-typing", function (e, frm) {
			me.form_stopped_typing(frm.doctype, frm.docname);
		});

		window.addEventListener("beforeunload", () => {
			if (!cur_frm || !cur_frm.doc || cur_frm.is_new()) {
				return;
			}

			me.doc_close(cur_frm.doctype, cur_frm.docname);
		});
	}

	get_host(port = 3000) {
		var host = window.location.origin;
		if (window.dev_server) {
			var parts = host.split(":");
			port = frappe.boot.socketio_port || port.toString() || "3000";
			if (parts.length > 2) {
				host = parts[0] + ":" + parts[1];
			}
			host = host + ":" + port;
		}
		return host;
	}

	subscribe(task_id, opts) {
		// TODO DEPRECATE

		this.socket.emit("task_subscribe", task_id);
		this.socket.emit("progress_subscribe", task_id);

		this.open_tasks[task_id] = opts;
	}
	task_subscribe(task_id) {
		this.socket.emit("task_subscribe", task_id);
	}
	task_unsubscribe(task_id) {
		this.socket.emit("task_unsubscribe", task_id);
	}
	doctype_subscribe(doctype) {
		this.socket.emit("doctype_subscribe", doctype);
	}
	doctype_unsubscribe(doctype) {
		this.socket.emit("doctype_unsubscribe", doctype);
	}
	doc_subscribe(doctype, docname) {
		if (frappe.flags.doc_subscribe) {
			console.log("throttled");
			return;
		}

		frappe.flags.doc_subscribe = true;

		// throttle to 1 per sec
		setTimeout(function () {
			frappe.flags.doc_subscribe = false;
		}, 1000);

		this.socket.emit("doc_subscribe", doctype, docname);
		this.open_docs.push({ doctype: doctype, docname: docname });
	}
	doc_unsubscribe(doctype, docname) {
		this.socket.emit("doc_unsubscribe", doctype, docname);
		this.open_docs = $.filter(frappe.socketio.open_docs, function (d) {
			if (d.doctype === doctype && d.name === docname) {
				return null;
			} else {
				return d;
			}
		});
	}
	doc_open(doctype, docname) {
		this.socket.emit("doc_open", doctype, docname);
	}
	doc_close(doctype, docname) {
		this.socket.emit("doc_close", doctype, docname);
	}
	setup_listeners() {
		this.socket.on("task_status_change", function (data) {
			this.process_response(data, data.status.toLowerCase());
		});
		this.socket.on("task_progress", function (data) {
			this.process_response(data, "progress");
		});
	}
	process_response(data, method) {
		if (!data) {
			return;
		}

		// success
		var opts = this.open_tasks[data.task_id];
		if (opts[method]) {
			opts[method](data);
		}

		// "callback" is std frappe term
		if (method === "success") {
			if (opts.callback) opts.callback(data);
		}

		// always
		frappe.request.cleanup(opts, data);
		if (opts.always) {
			opts.always(data);
		}

		// error
		if (data.status_code && data.status_code > 400 && opts.error) {
			opts.error(data);
		}
	}

	publish(event, message) {
		if (this.socket) {
			this.socket.emit(event, message);
		}
	}
}

frappe.realtime = new RealTimeClient();

// backward compatbility
frappe.socketio = frappe.realtime;
