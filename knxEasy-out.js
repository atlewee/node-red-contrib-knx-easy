const dptlib = require('knx-dpt')
module.exports = function (RED) {
    function knxEasyOut(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.server = RED.nodes.getNode(config.server)
        node.topic = config.topic
        node.dpt = config.dpt || "1.001"
        node.outputtype = config.outputtype || "write"

        if (node.server) {
            if (node.topic) {
                node.server.register("out", node)
            }
        }

        node.on("input", function (msg) {
            if (node.server) {
                if (node.server.knxConnection) {
                    let outputtype =
                        msg.knx && msg.knx.event
                            ? msg.knx.event == "GroupValue_Response"
                                ? "response"
                                : msg.knx.event == "GroupValue_Write"
                                    ? "write"
                                    : node.outputtype
                            : node.outputtype

                    let grpaddr =
                        msg.knx && msg.knx.destination
                            ? msg.knx.destination
                            : node.topic
                    let dpt = msg.knx && msg.knx.dpt
                        ? msg.knx.dpt
                        : node.dpt
                    if (outputtype == "response") {
                        node.server.knxConnection.respond(grpaddr, msg.payload, dpt)
                    } else {
                        node.server.knxConnection.write(grpaddr, msg.payload, dpt)
                    }
                }
            }
        })

        node.on('close', function () {
            if (node.server) {
                node.server.deregister("out", node);
            }
        })
    }
    RED.nodes.registerType("knxEasy-out", knxEasyOut)
}