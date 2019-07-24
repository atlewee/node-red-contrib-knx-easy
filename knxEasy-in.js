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
        node.listenallga = config.listenallga || false
        
  
        
        node.on("input", function (msg) {
            if (!node.listenallga) {
                if (node.server && node.topic) {
                    node.server.readValue(node.topic)
                }
            } else {
                if (node.server) {
                    for (let index = 0; index < node.server.csv.length; index++) {
                        const element = node.server.csv[index];
                        node.server.readValue(element.ga)
                    }
                }
            }
            
        })

        node.on('close', function () {
            if (node.server) {
                node.server.deregister("in", node)
            }
        })

        if (node.server) {
            if (node.topic || node.listenallga ) {
                node.server.register("in", node)
            }
        }
    }
    RED.nodes.registerType("knxEasy-in", knxEasyIn)
}
