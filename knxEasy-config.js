const knx = require('knx')
const dptlib = require('knx-dpt')

module.exports = function (RED) {
    function knxEasyConfigNode(n) {
        RED.nodes.createNode(this, n)
        var node = this
        node.host = n.host
        node.port = n.port

        var knxErrorTimeout

        node.inputUsers = {}
        node.outputUsers = {}

        node.register = function (userType, knxNode) {
            userType == "in"
                ? node.inputUsers[knxNode.id] = knxNode
                : node.outputUsers[knxNode.id] = knxNode
            if (Object.keys(node.inputUsers).length + Object.keys(node.outputUsers).length === 1) {
                node.connect();
            }
        }

        node.deregister = function (userType, knxNode) {
            userType == "in"
                ? delete node.inputUsers[knxNode.id]
                : delete node.outputUsers[knxNode.id]
            if (Object.keys(node.inputUsers).length + Object.keys(node.outputUsers).length === 0) {
                node.knxConnection = null
            }
        }

        node.readInitialValues = function () {
            var delay = 50
            for (var id in node.inputUsers) {
                if (node.inputUsers.hasOwnProperty(id)) {
                    let inputNode = node.inputUsers[id]
                    if (inputNode.initialread) {
                        setTimeout(inputNode._events.input, delay)
                        delay = delay + 50
                    }
                }
            }
        }

        node.setStatusHelper = function (fill, text) {
            for (var id in node.inputUsers) {
                if (node.inputUsers.hasOwnProperty(id)) {
                    node.inputUsers[id].status({ fill: fill, shape: "dot", text: text })
                }
            }
            for (var id in node.outputUsers) {
                if (node.outputUsers.hasOwnProperty(id)) {
                    node.outputUsers[id].status({ fill: fill, shape: "dot", text: text })
                }
            }
        }

        node.setStatus = function (status) {
            switch (status) {
                case "connected":
                    node.setStatusHelper("green", "node-red:common.status.connected")
                    break
                case "knxError":
                    node.setStatusHelper("yellow", "connected, but error on knx-bus")
                    break
                case "disconnected":
                    node.setStatusHelper("red", "node-red:common.status.disconnected")
                    break
                default:
            }
        }

        node.connect = function () {
            node.setStatus("disconnected")
            node.knxConnection = new knx.Connection({
                ipAddr: node.host,
                ipPort: node.port,
                handlers: {
                    connected: function () {
                        if (knxErrorTimeout == undefined) {
                            node.setStatus("connected")
                            node.readInitialValues()
                        }
                    },
                    error: function (connstatus) {
                        node.error(connstatus)
                        if (connstatus == "E_KNX_CONNECTION") {
                            node.setStatus("knxError")
                        } else {
                            node.setStatus("disconnected")
                        }
                    }
                }
            })
            node.knxConnection.on("event", function (evt, src, dest, value) {
                if (evt == "GroupValue_Write" || evt == "GroupValue_Response") {
                    for (var id in node.inputUsers) {
                        if (node.inputUsers.hasOwnProperty(id)) {
                            var input = node.inputUsers[id]
                            if (input.topic == dest) {
                                var dpt = dptlib.resolve(input.dpt)
                                var jsValue = dptlib.fromBuffer(value, dpt)
                                var msg =
                                {
                                    topic: dest
                                    , payload: jsValue
                                    , knx:
                                    {
                                        event: evt
                                        , dpt: input.dpt
                                        , dptDetails: dpt
                                        , source: src
                                        , destination: dest
                                        , rawValue: value
                                    }
                                }
                                input.send(msg)
                            }
                        }
                    }
                }
            })
        }

        node.on("close", function () {
            node.setStatus("disconnected")
            node.knxConnection.Disconnect()
            node.knxConnection = null
        })
    }
    RED.nodes.registerType("knxEasy-config", knxEasyConfigNode);
}
