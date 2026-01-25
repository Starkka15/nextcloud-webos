# Nextcloud Client for webOS
# Makefile for PDK build

WEBOS_PDK ?= /opt/PalmPDK
TOOLCHAIN = $(WEBOS_PDK)/arm-toolchain/bin

CC = $(TOOLCHAIN)/arm-none-linux-gnueabi-gcc
STRIP = $(TOOLCHAIN)/arm-none-linux-gnueabi-strip

APP_NAME = nextcloud-webos
APP_ID = org.webos.nextcloud

# Compiler flags
CFLAGS = -O2 -Wall -std=gnu99
CFLAGS += -I$(WEBOS_PDK)/include
CFLAGS += -I$(WEBOS_PDK)/include/SDL

# Linker flags
LDFLAGS = -L$(WEBOS_PDK)/device/lib
LDFLAGS += -Wl,--allow-shlib-undefined

# Libraries
LIBS = -lSDL -lSDL_ttf -lSDL_image -lpdl -lcurl -lssl -lcrypto

# Source files
SRC = src/main.c src/webdav.c src/ui.c src/config.c src/xml_parser.c src/http_client.c
OBJ = $(SRC:.c=.o)

# Output
TARGET = $(APP_NAME)

.PHONY: all clean package install

all: $(TARGET)

$(TARGET): $(OBJ)
	$(CC) $(LDFLAGS) -o $@ $^ $(LIBS)
	$(STRIP) $@

%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<

clean:
	rm -f $(OBJ) $(TARGET) *.ipk

package: $(TARGET)
	palm-package .

install: package
	palm-install $(APP_ID)_*.ipk

run: install
	palm-launch $(APP_ID)
