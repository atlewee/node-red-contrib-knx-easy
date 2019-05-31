module.exports = function (RED) {
    function knxEasyIn(config) {
        RED.nodes.createNode(this, config)
        var node = this
        node.server = RED.nodes.getNode(config.server)
        node.topic = config.topic
        node.dpt = config.dpt || "1.001"
        node.notifyreadrequest = config.notifyreadrequest || false
        node.notifyresponse = config.notifyresponse || false
        node.notifywrite = config.notifywrite
        node.initialread = config.initialread || false

        node.on("input", function (msg) {
            if (node.server && node.server.knxConnection && node.topic) {
                node.server.knxConnection.read(node.topic)
            }
        })

        node.on('close', function () {
            if (node.server) {
                node.server.deregister("in", node)
            }
        })

        if (node.server) {
            if (node.topic) {
                node.server.register("in", node)
            }
        }
    }
    RED.nodes.registerType("knxEasy-in", knxEasyIn)
}
