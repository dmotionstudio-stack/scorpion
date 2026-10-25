/* Scorpion OS installer: what shows while it installs. */
import QtQuick 2.0;
import calamares.slideshow 1.0;

Presentation {
    id: presentation

    function onActivate() { }
    function onLeave() { }

    Timer {
        interval: 9000
        running: presentation.activatedInCalamares
        repeat: true
        onTriggered: presentation.goToNextSlide()
    }

    Slide {
        Rectangle { anchors.fill: parent; color: "#0e0d0b" }
        Image { id: logo; source: "logo.png"; width: 160; height: 160; fillMode: Image.PreserveAspectFit; anchors.centerIn: parent; anchors.verticalCenterOffset: -60 }
        Text { anchors.top: logo.bottom; anchors.topMargin: 24; anchors.horizontalCenter: parent.horizontalCenter; color: "#f2eee2"; font.pixelSize: 22; text: "Scorpion OS is being installed" }
    }
    Slide {
        Rectangle { anchors.fill: parent; color: "#0e0d0b" }
        Text { anchors.centerIn: parent; width: parent.width * 0.7; wrapMode: Text.WordWrap; horizontalAlignment: Text.AlignHCenter; color: "#f2eee2"; font.pixelSize: 18
               text: "Your AI runs on this computer: models, voice, faces and hand gestures never leave it." }
    }
    Slide {
        Rectangle { anchors.fill: parent; color: "#0e0d0b" }
        Text { anchors.centerIn: parent; width: parent.width * 0.7; wrapMode: Text.WordWrap; horizontalAlignment: Text.AlignHCenter; color: "#f2eee2"; font.pixelSize: 18
               text: "Installed alongside Windows? The boot menu lets you pick Scorpion OS or Windows each time the computer starts." }
    }
}
